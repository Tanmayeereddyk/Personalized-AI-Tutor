"""Retrieval-Augmented Generation core: chunking, indexing and retrieval.

Pipeline
--------
``extracted_units`` (text / tables / transcripts) → chunk → embed → store in the
persistent ``rag_chunks`` table → retrieve by cosine similarity → feed notes and
the tutor.

Design notes
------------
- Every chunk keeps its provenance: ``material_id``, ``user_id``, ``course_id``,
  ``source_type``, ``chunk_order`` and any ``page_number`` / ``slide_number`` /
  ``start_timestamp_seconds`` / ``end_timestamp_seconds`` the source unit had.
- Empty or failed extraction results are never indexed: only units that really
  carry text (and are not extraction warning/summary rows) become chunks.
- Indexing is repeatable: a material is re-indexed by inserting the fresh chunks
  first and then deleting the previous ones, so a retry can never duplicate a
  material's chunks.
- Retrieval always filters by the authenticated ``user_id`` (and, when given, the
  selected ``material_id`` / course), so one user's chunks can never be returned
  to another user.
"""

from __future__ import annotations

import re

from fastapi import HTTPException
from supabase import Client, PostgrestAPIError

from app.core.config import settings
from app.services import embeddings, extracted_unit_service, owned_service

TABLE = "rag_chunks"

_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+")
_WHITESPACE = re.compile(r"\s+")


class RagStoreUnavailable(HTTPException):
    """The RAG tables are missing (the migration has not been applied).

    Reported as 503 with an actionable message instead of a bare "database
    error", so the UI can tell the user exactly which SQL to run.
    """

    def __init__(self) -> None:
        super().__init__(
            status_code=503,
            detail=(
                "Notes and tutor answers are not available yet because the RAG "
                "tables are missing. Run database/migrations/005_rag_pipeline.sql "
                "(or database/schema.sql) in the Supabase SQL editor, then retry."
            ),
        )


def _is_missing_store(exc: PostgrestAPIError) -> bool:
    """True when the failure means the RAG table itself does not exist."""
    code = getattr(exc, "code", None)
    if code in {"PGRST205", "42P01"}:
        return True
    text = str(exc).lower()
    return "schema cache" in text or "does not exist" in text


def _db_error(exc: PostgrestAPIError) -> HTTPException:
    if _is_missing_store(exc):
        return RagStoreUnavailable()
    return HTTPException(
        status_code=500,
        detail="Database error. Run database/schema.sql in Supabase first.",
    )


# ----------------------------------------------------------------------
# Chunking
# ----------------------------------------------------------------------

def _split_text(text: str, target: int, overlap: int) -> list[str]:
    """Split a text block into overlapping, sentence-aligned windows."""
    clean = _WHITESPACE.sub(" ", text).strip()
    if not clean:
        return []
    if len(clean) <= target:
        return [clean]

    sentences = _SENTENCE_SPLIT.split(clean)
    chunks: list[str] = []
    current = ""
    for sentence in sentences:
        candidate = f"{current} {sentence}".strip()
        if current and len(candidate) > target:
            chunks.append(current)
            # Start the next window with a little overlap so meaning that
            # straddles the boundary is not lost.
            tail = current[-overlap:] if overlap > 0 else ""
            current = f"{tail} {sentence}".strip()
        else:
            current = candidate
    if current:
        chunks.append(current)

    # A single monster sentence can still exceed the target; hard-split those.
    final: list[str] = []
    for chunk in chunks:
        if len(chunk) <= target * 2:
            final.append(chunk)
            continue
        step = max(1, target - overlap)
        for start in range(0, len(chunk), step):
            final.append(chunk[start:start + target])
    return [c for c in final if c.strip()]


def _is_indexable_unit(unit: dict) -> bool:
    """True when a unit really carries text that can become a chunk.

    Warning/summary rows, failed extractions and text-less units (e.g. a video
    frame) are excluded, so nothing that was not really extracted is indexed.
    """
    if extracted_unit_service.is_summary_row(unit):
        return False
    if (unit.get("status") or "extracted") == "failed":
        return False
    return bool((unit.get("content") or "").strip())


def indexable_units(units: list[dict]) -> list[dict]:
    """The subset of ``units`` that would actually become chunks."""
    return [unit for unit in units if _is_indexable_unit(unit)]


def build_chunks(material: dict, units: list[dict]) -> list[dict]:
    """Turn an extraction run's units into indexable chunk rows.

    Summary/warning rows and failed or text-less units are skipped, so nothing
    that was not really extracted is ever indexed as valid content.
    """
    chunks: list[dict] = []
    order = 0
    for unit in units:
        if not _is_indexable_unit(unit):
            continue
        content = (unit.get("content") or "").strip()
        metadata = unit.get("metadata") or {}
        for piece in _split_text(
            content, settings.RAG_CHUNK_CHARS, settings.RAG_CHUNK_OVERLAP_CHARS
        ):
            order += 1
            chunks.append(
                {
                    "material_id": material["id"],
                    "user_id": material["user_id"],
                    "course_id": material["course_id"],
                    "source_type": (material.get("type") or "doc").lower(),
                    "chunk_order": order,
                    "content": piece,
                    "page_number": unit.get("page_number"),
                    "slide_number": unit.get("slide_number"),
                    "start_timestamp_seconds": unit.get("start_timestamp_seconds"),
                    "end_timestamp_seconds": unit.get("end_timestamp_seconds"),
                    "extraction_method": unit.get("extraction_method"),
                    "source_kind": metadata.get("kind") or metadata.get("source"),
                }
            )
    return chunks


# ----------------------------------------------------------------------
# Indexing
# ----------------------------------------------------------------------

def replace_chunks(
    client: Client, user_id: str, material_id: str, rows: list[dict]
) -> list[dict]:
    """Persist a fresh index for one material without duplicating chunks.

    Same safe pattern as ``extracted_unit_service.replace_units``: insert the new
    rows first, then delete the previous rows that are not part of the new set.
    """
    extracted_unit_service.ensure_material_owned(client, user_id, material_id)

    if not rows:
        try:
            (
                client.table(TABLE)
                .delete()
                .eq("material_id", material_id)
                .execute()
            )
        except PostgrestAPIError as exc:
            raise _db_error(exc) from exc
        return []

    try:
        inserted = client.table(TABLE).insert(rows).execute()
    except PostgrestAPIError as exc:
        raise _db_error(exc) from exc

    inserted_rows = list(inserted.data or [])
    new_ids = [row["id"] for row in inserted_rows if row.get("id")]
    if new_ids:
        try:
            (
                client.table(TABLE)
                .delete()
                .eq("material_id", material_id)
                .not_.in_("id", new_ids)
                .execute()
            )
        except PostgrestAPIError as exc:
            raise _db_error(exc) from exc
    return inserted_rows


def index_material(client: Client, user_id: str, material_id: str) -> dict:
    """Chunk, embed and store one material's extracted content.

    Returns a small summary the API exposes (chunk count + embedding model).
    """
    material = extracted_unit_service.ensure_material_owned(
        client, user_id, material_id
    )
    units = extracted_unit_service.list_units(client, user_id, material_id)
    chunks = build_chunks(material, units)

    model_name = embeddings.embedding_model_name()
    vectors = embeddings.embed_texts([chunk["content"] for chunk in chunks])
    for chunk, vector in zip(chunks, vectors):
        chunk["embedding"] = vector
        chunk["embedding_model"] = model_name

    saved = replace_chunks(client, user_id, material_id, chunks)
    return {
        "material_id": material_id,
        "chunk_count": len(saved),
        "embedding_model": model_name,
    }


def chunk_count(client: Client, user_id: str, material_id: str) -> int:
    """How many chunks are currently indexed for a material (owner only)."""
    extracted_unit_service.ensure_material_owned(client, user_id, material_id)
    try:
        result = (
            client.table(TABLE)
            .select("id")
            .eq("user_id", user_id)
            .eq("material_id", material_id)
            .execute()
        )
    except PostgrestAPIError as exc:
        raise _db_error(exc) from exc
    return len(result.data or [])


def ensure_material_indexed(client: Client, user_id: str, material_id: str) -> int:
    """Return a material's chunk count, indexing it first when it has none.

    Extraction normally builds the index automatically. If that step was
    skipped or failed (an older upload, or a previous indexing error), this
    re-processes the material's *existing* extracted units so notes can still
    be generated from real content instead of failing. Materials with nothing
    indexable are left untouched and report ``0``.
    """
    current = chunk_count(client, user_id, material_id)
    if current:
        return current
    units = extracted_unit_service.list_units(client, user_id, material_id)
    if not indexable_units(units):
        return 0
    index_material(client, user_id, material_id)
    return chunk_count(client, user_id, material_id)


def delete_chunks_for_material(client: Client, user_id: str, material_id: str) -> None:
    """Remove a material's chunks/embeddings (called when it is deleted)."""
    try:
        (
            client.table(TABLE)
            .delete()
            .eq("user_id", user_id)
            .eq("material_id", material_id)
            .execute()
        )
    except PostgrestAPIError as exc:
        raise _db_error(exc) from exc


# ----------------------------------------------------------------------
# Reading + retrieval
# ----------------------------------------------------------------------

def list_chunks(
    client: Client,
    user_id: str,
    *,
    course_id: str | None = None,
    material_id: str | None = None,
) -> list[dict]:
    """Every chunk the caller is allowed to read, in source order."""
    query = client.table(TABLE).select("*").eq("user_id", user_id)
    if course_id is not None:
        owned_service.ensure_course_owned(client, user_id, course_id)
        query = query.eq("course_id", course_id)
    if material_id is not None:
        extracted_unit_service.ensure_material_owned(client, user_id, material_id)
        query = query.eq("material_id", material_id)
    try:
        result = query.execute()
    except PostgrestAPIError as exc:
        raise _db_error(exc) from exc

    rows = list(result.data or [])
    # chunk_order is per material, so order by (material, order) to keep one
    # material's content together and in source order.
    rows.sort(key=lambda row: (str(row.get("material_id")), row.get("chunk_order") or 0))
    return rows


def retrieve_with_scores(
    client: Client,
    user_id: str,
    query: str,
    *,
    course_id: str | None = None,
    material_id: str | None = None,
    top_k: int | None = None,
) -> list[tuple[float, dict]]:
    """The most relevant chunks for a query, each with its similarity score.

    Only the caller's own chunks are considered. If ``material_id`` is given the
    search is restricted to that material (after an ownership check), so a
    material-selection filter is always respected. Ties are broken by
    ``chunk_order`` so the result is deterministic and keeps source order.
    """
    query_vector = embeddings.embed_text(query)
    rows = list_chunks(
        client, user_id, course_id=course_id, material_id=material_id
    )
    scored = [
        (embeddings.cosine_similarity(query_vector, row.get("embedding") or []), row)
        for row in rows
    ]
    scored.sort(
        key=lambda item: (item[0], item[1].get("chunk_order") or 0), reverse=True
    )
    limit = top_k or settings.RAG_TOP_K
    return scored[:limit]


def retrieve(
    client: Client,
    user_id: str,
    query: str,
    *,
    course_id: str | None = None,
    material_id: str | None = None,
    top_k: int | None = None,
) -> list[dict]:
    """The most relevant chunk rows for a query (scores discarded)."""
    return [
        row
        for _score, row in retrieve_with_scores(
            client,
            user_id,
            query,
            course_id=course_id,
            material_id=material_id,
            top_k=top_k,
        )
    ]
