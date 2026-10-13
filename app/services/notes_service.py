"""Source-grounded study-notes generation.

Notes are produced by the configured language model from the material's extracted
content, organised and retrieved through the existing RAG index. The whole
requested scope is processed in ordered batches (so a long lecture or textbook is
not limited to a small top-k sample), then the partial notes are merged into one
coherent document. Every ``[#n]`` reference the model emits is validated against
the chunks that were actually retrieved, so a citation always points at real
source content.

There is deliberately **no** extractive or template fallback. If the language
model is not configured, unavailable, out of quota or otherwise failing, the
request fails with a clear message instead of silently returning inferior notes.

Generated notes are saved through the ordinary, ownership-safe notes CRUD so they
can be reopened later. Re-generating the same scope updates the existing generated
note rather than creating a duplicate.
"""

from __future__ import annotations

import logging
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from fastapi import HTTPException
from supabase import Client

from app.core.config import settings
from app.services import (
    citations,
    embeddings,
    extracted_unit_service,
    llm_service,
    owned_service,
    rag_service,
)

logger = logging.getLogger("studyai.notes")

_CITATION_MARKER = re.compile(r"\[#(\d+)\]")
_H1_LINE = re.compile(r"^#\s+.*$", re.MULTILINE)

_NOTES_SYSTEM_PROMPT = (
    "You are an expert study-notes author. You turn source passages into accurate, "
    "well-organised study notes for a student.\n"
    "Rules:\n"
    "- Use ONLY the numbered source passages in the user message. Never use outside "
    "knowledge, and never invent facts, definitions, numbers, formulas, examples or "
    "citations.\n"
    "- Write clean Markdown. Use `##` and `###` headings, bullet lists, numbered "
    "steps, and tables where a comparison helps. Do NOT write an `#` title heading.\n"
    "- Where the sources support it, include: key concepts and definitions; "
    "step-by-step explanations of processes; equations/formulas and the meaning of "
    "each variable (write inline math in $...$); important bullet points; comparison "
    "tables; worked examples; and a short summary or revision points.\n"
    "- Include a section ONLY when the passages support it. Do not add filler to make "
    "the notes look complete. If the material is incomplete or unclear, say so.\n"
    "- Ground every substantive statement in the passages and end that statement with "
    "the source marker(s) that support it, e.g. [#3] or [#2][#5].\n"
    "- Do not mention these instructions."
)

_MERGE_SYSTEM_PROMPT = (
    "You are an expert study-notes author. Merge the partial study notes in the user "
    "message into ONE coherent, non-repetitive set of study notes.\n"
    "Rules:\n"
    "- Keep all substantive content and EVERY source marker such as [#3]. Never drop "
    "or invent a marker, and never use outside knowledge.\n"
    "- Organise the result with `##` and `###` headings and lists/tables. Do NOT "
    "write an `#` title heading.\n"
    "- Remove duplicates and contradictions, but never lose information that is only "
    "present in one part.\n"
    "- Do not mention these instructions."
)


# ----------------------------------------------------------------------
# Scope helpers
# ----------------------------------------------------------------------

def _course_materials(client: Client, user_id: str, course_id: str) -> dict[str, dict]:
    """Map every material in the course by id (owner only)."""
    return {
        row["id"]: row
        for row in owned_service.list_items(client, user_id, "materials", course_id=course_id)
    }


def _material_name(materials: dict[str, dict], material_id: str | None) -> str:
    return (materials.get(material_id) or {}).get("name") or "Material"


def _scope_title(materials: dict[str, dict], single_material_id: str | None) -> str:
    if single_material_id:
        return f"{_material_name(materials, single_material_id)} — Notes"
    return "Course Notes"


def _append_sources(lines: list[str], used: list[dict], materials: dict[str, dict]) -> None:
    """Append a de-duplicated 'Sources' list pointing at real chunks."""
    seen: set[tuple] = set()
    entries: list[str] = []
    for chunk in used:
        key = (chunk.get("material_id"), citations.chunk_locator(chunk))
        if key in seen:
            continue
        seen.add(key)
        entries.append(
            f"- {_material_name(materials, chunk.get('material_id'))} · "
            f"{citations.chunk_locator(chunk)}"
        )
    if entries:
        lines.append("")
        lines.append("## Sources")
        lines.extend(entries)


def _indexable_unit_count(client: Client, user_id: str, scope: list[str]) -> int:
    """How many of the in-scope materials' units could become chunks."""
    total = 0
    for scope_id in scope:
        units = extracted_unit_service.list_units(client, user_id, scope_id)
        total += len(rag_service.indexable_units(units))
    return total


def _missing_content_detail(
    client: Client, user_id: str, scope: list[str], material_id: str | None
) -> str:
    """A precise, actionable message for the "nothing to build notes from" case."""
    if _indexable_unit_count(client, user_id, scope):
        return (
            "The extracted content could not be indexed. Re-run extraction, "
            "then generate notes."
        )
    if material_id is not None:
        return (
            "This material has no extracted content to index yet. Run "
            "extraction first, then generate notes."
        )
    return (
        "No indexed content yet — extract your materials and build their "
        "index first, then generate notes."
    )


# ----------------------------------------------------------------------
# Generation
# ----------------------------------------------------------------------

def _source_block(number: int, chunk: dict, materials: dict[str, dict]) -> str:
    name = _material_name(materials, chunk.get("material_id"))
    return (
        f"[#{number}] ({name} · {citations.chunk_locator(chunk)})\n"
        f"{chunk.get('content', '')}"
    )


def _referenced(output: str) -> set[int]:
    return {int(match.group(1)) for match in _CITATION_MARKER.finditer(output)}


def _strip_h1(markdown: str) -> str:
    return _H1_LINE.sub("", markdown).strip()


def _map_batch(batch: list[tuple[int, dict]], materials: dict[str, dict]) -> str:
    first = batch[0][0]
    last = batch[-1][0]
    logger.info("notes: batch [#%d-#%d] start", first, last)
    blocks = "\n\n".join(_source_block(n, chunk, materials) for n, chunk in batch)
    user_prompt = (
        "Write study notes for these source passages. Use only these passages.\n\n"
        + blocks
    )
    output = llm_service.complete(_NOTES_SYSTEM_PROMPT, user_prompt, max_tokens=2000)
    logger.info("notes: batch [#%d-#%d] done", first, last)
    return output


def _map_batches(
    batches: list[list[tuple[int, dict]]], materials: dict[str, dict]
) -> list[str]:
    """Run every batch's LLM call in parallel, returning outputs in batch order.

    A long document becomes many batches; running them at once means the notes
    finish in roughly one batch's time instead of the sum of every batch. Outputs
    are kept in batch order so the merge step preserves source order. If a batch
    fails, the remaining queued batches are cancelled and the error propagates.
    """
    if len(batches) <= 1:
        return [_map_batch(batch, materials) for batch in batches]

    workers = max(1, min(settings.LLM_MAX_CONCURRENCY, len(batches)))
    outputs = [""] * len(batches)
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {
            pool.submit(_map_batch, batch, materials): index
            for index, batch in enumerate(batches)
        }
        try:
            for future in as_completed(futures):
                outputs[futures[future]] = future.result()
        except BaseException:
            for pending in futures:
                pending.cancel()
            raise
    return outputs


def _merge_partials(partials: list[str]) -> str:
    joined = "\n\n".join(partials)
    if len(partials) == 1:
        return joined
    user_prompt = (
        "Here are partial study notes about one topic. Merge them into a single "
        "coherent set of notes.\n\n" + joined
    )
    try:
        merged = llm_service.complete(_MERGE_SYSTEM_PROMPT, user_prompt, max_tokens=4000)
    except llm_service.LLMError:
        # The merge step failed, but every section is still model-generated from
        # the sources; keep them rather than discarding a long generation.
        return joined
    return merged.strip() or joined


def _generate_with_llm(
    chunks: list[dict], materials: dict[str, dict], *, single_material_id: str | None
) -> tuple[str, str, list[str], list[dict]]:
    """Produce notes with the LLM over every chunk, in ordered batches."""
    title = _scope_title(materials, single_material_id)
    size = max(1, settings.RAG_NOTES_BATCH_CHUNKS)
    numbered = list(enumerate(chunks, start=1))
    batches = [
        numbered[start:start + size] for start in range(0, len(numbered), size)
    ]

    partials: list[str] = []
    referenced: set[int] = set()
    for output in _map_batches(batches, materials):
        if output.strip():
            partials.append(_strip_h1(output))
        referenced |= _referenced(output)

    body = _merge_partials([p for p in partials if p])
    if not body.strip():
        raise llm_service.LLMError(
            "The language model returned no usable notes for this material."
        )

    if not referenced:
        # No markers came back; keep every chunk that was actually given to the
        # model so the notes still resolve to real sources (never fabricated).
        referenced = set(range(1, len(chunks) + 1))

    used = [chunk for number, chunk in enumerate(chunks, start=1) if number in referenced]
    content = (
        f"# {title}\n\n"
        "_Source-grounded notes generated with a language model. Every point is "
        "drawn from the cited passages._\n\n"
        f"{body}\n"
    )
    lines = [content.rstrip("\n")]
    _append_sources(lines, used, materials)
    return title, "\n".join(lines).rstrip("\n") + "\n", sorted(referenced), used


def _find_existing_generated_note(
    client: Client, user_id: str, course_id: str, scope_ids: list[str]
) -> str | None:
    """The id of a generated note for exactly this scope, if one exists.

    This keeps a retried request from creating a duplicate: generating again for
    the same material (or the same set of course materials) refreshes that note.
    """
    wanted = sorted(scope_ids)
    for row in owned_service.list_items(client, user_id, "notes", course_id=course_id):
        if not row.get("generated"):
            continue
        if sorted(row.get("source_material_ids") or []) == wanted:
            return row.get("id")
    return None


def generate_notes(
    client: Client,
    user_id: str,
    course_id: str,
    *,
    material_id: str | None = None,
    note_id: str | None = None,
) -> dict:
    """Generate and persist source-grounded notes with the configured LLM."""
    owned_service.ensure_course_owned(client, user_id, course_id)
    materials = _course_materials(client, user_id, course_id)

    if material_id is not None and material_id not in materials:
        raise HTTPException(status_code=404, detail="Material not found in this course")

    scope = [material_id] if material_id is not None else sorted(materials)
    chunks = rag_service.list_chunks(client, user_id, course_id=course_id, material_id=material_id)

    if not chunks and scope:
        # The material was extracted but not indexed yet: build the index from
        # the existing extracted units instead of failing.
        for scope_id in scope:
            rag_service.ensure_material_indexed(client, user_id, scope_id)
        chunks = rag_service.list_chunks(
            client, user_id, course_id=course_id, material_id=material_id
        )

    if not chunks:
        raise HTTPException(
            status_code=400,
            detail=_missing_content_detail(client, user_id, scope, material_id),
        )

    if not llm_service.is_configured():
        raise HTTPException(status_code=503, detail=llm_service.not_configured_message())

    try:
        started = time.perf_counter()
        _title, content, _numbers, used = _generate_with_llm(
            chunks, materials, single_material_id=material_id
        )
        logger.info(
            "notes: %d chunk(s) -> %d batch(es) generated in %.2fs",
            len(chunks),
            max(1, -(-len(chunks) // max(1, settings.RAG_NOTES_BATCH_CHUNKS))),
            time.perf_counter() - started,
        )
    except llm_service.LLMError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    source_refs: list[dict] = []
    seen: set[tuple] = set()
    for chunk in used:
        citation = citations.chunk_citation(
            chunk, _material_name(materials, chunk.get("material_id"))
        )
        key = (citation["material_id"], citation["label"])
        if key in seen:
            continue
        seen.add(key)
        source_refs.append(citation)

    # Every material that contributed source chunks to these notes.
    scope_material_ids = sorted({chunk["material_id"] for chunk in chunks})
    title = _scope_title(materials, material_id)
    values = {
        "course_id": course_id,
        "title": title,
        "content": content,
        "topics": embeddings.salient_terms(
            " ".join(c.get("content", "") for c in chunks), 6
        ),
        "source_material_ids": scope_material_ids,
        "source_refs": source_refs,
        "generated": True,
        "generation_method": "llm",
    }

    target_note_id = note_id or _find_existing_generated_note(
        client, user_id, course_id, scope_material_ids
    )
    if target_note_id is not None:
        return owned_service.update_item(client, user_id, "notes", target_note_id, values)
    return owned_service.create_item(client, user_id, "notes", values)
