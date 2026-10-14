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
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from fastapi import HTTPException
from supabase import Client

from app.core.config import settings
from app.services import (
    citations,
    embeddings,
    extracted_unit_service,
    extraction_service,
    llm_service,
    owned_service,
    rag_service,
)

# How long a Generate request will wait for an extraction that an upload already
# started (a background task). A second extraction is never started while one is
# running, because two concurrent ``replace_units`` / ``replace_chunks`` runs
# could delete each other's freshly inserted rows.
_PREPARE_WAIT_SECONDS = 180.0
_PREPARE_POLL_SECONDS = 1.0

# Process-local locks, one per (user, course, material) scope. Two identical
# Generate requests (a double click, or two tabs) are serialized: the second
# waits, then sees the first run's content/index and refreshes the same note
# instead of duplicating extraction, chunks or notes.
_SCOPE_LOCKS: dict[str, threading.Lock] = {}
_SCOPE_LOCKS_GUARD = threading.Lock()


def _scope_lock(key: str) -> threading.Lock:
    with _SCOPE_LOCKS_GUARD:
        return _SCOPE_LOCKS.setdefault(key, threading.Lock())

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
    "- Do not copy source-location labels such as \"Slide 12\", \"Page 3\" or "
    "\"Slide 1 of 20\" into the notes, and do not use them as headings: they say "
    "where a passage came from, not what it means. Keep every meaningful heading, "
    "number, formula, date and numbered step.\n"
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
    "- Do not copy source-location labels such as \"Slide 12\", \"Page 3\" or "
    "\"Slide 1 of 20\" into the notes: they say where a passage came from, not what "
    "it means. Keep every meaningful heading, number, formula and step.\n"
    "- Do not mention these instructions."
)


# ----------------------------------------------------------------------
# Source-location label cleanup
# ----------------------------------------------------------------------
#
# The model is shown each passage as ``[#3] (slides.pdf · Slide 12)``, so it
# sometimes copies the trailing location into the notes as a heading
# (``## Slide 12``), a heading prefix (``### Slide 3: Ohm's Law``) or a
# provenance tag (``... (Slide 12)``). Those labels are extraction metadata, not
# study content, so they are stripped from the generated document.
#
# The rules are deliberately narrow: only the words "slide"/"page" followed by
# a number are ever considered, the label has to be a whole line, a heading
# prefix or a wrapped/separated trailing tag. That keeps every meaningful
# number, formula, date, quoted page reference and numbered step intact.
_LOCATION_LABEL = r"(?:slide|page)\s*\d+"

# A line whose entire content is just a label, in whatever wrapping the model
# put around it: "## Slide 12", "**Page 3**", "- Slide 4:", "> Page 7".
_ONLY_LABEL_LINE = re.compile(
    rf"^[ \t]*(?:>[ \t]*)*(?:#{{1,6}}[ \t]+)?(?:[-*+][ \t]+)?"
    rf"(?:[*_~`]{{1,2}}[ \t]*)?"
    rf"\(?\[?[ \t]*{_LOCATION_LABEL}[ \t]*\]?\)?"
    rf"(?:[ \t]*[*_~`]{{1,2}})?[ \t]*[:：]?[ \t]*$",
    re.IGNORECASE,
)

# A label used as the first part of a line, kept only for what follows it:
# "### Slide 3: Ohm's Law" -> "### Ohm's Law".
_LABEL_PREFIX = re.compile(
    rf"^(?P<lead>[ \t]*(?:#{{1,6}}[ \t]+|[-*+][ \t]+|(?:[*_~`]{{1,2}})[ \t]*)?)"
    rf"\(?\[?[ \t]*{_LOCATION_LABEL}[ \t]*\]?\)?"
    rf"[ \t]*[:：\-–—][ \t]*(?:[*_~`]{{1,2}})?[ \t]*(?P<rest>\S.*)$",
    re.IGNORECASE,
)

# "...the current flows (Slide 6)." — a wrapped tag left at the end of a line.
# A trailing sentence punctuation mark is captured so it can be put back.
_TRAILING_WRAPPED = re.compile(
    rf"[ \t]*[([]\s*{_LOCATION_LABEL}\s*[)\]][ \t]*(?P<punct>[.!?])?[ \t]*$",
    re.IGNORECASE,
)

# "...capacitor charging — Slide 6" — a tag after a separator at line end.
_TRAILING_SEPARATED = re.compile(
    rf"[ \t]*[-–—|][ \t]+{_LOCATION_LABEL}[ \t]*(?P<punct>[.!?])?[ \t]*$",
    re.IGNORECASE,
)


def _remove_trailing_tags(line: str) -> str:
    """Drop a trailing location tag, keeping any sentence punctuation."""
    for pattern in (_TRAILING_WRAPPED, _TRAILING_SEPARATED):
        line = pattern.sub(lambda m: m.group("punct") or "", line)
    return line

# Numbered lists are never touched: a "3." or "3)" line is a real step even if
# it happens to start with one of the words above.
_NUMBERED_LINE = re.compile(r"^[ \t]*\d+[.)][ \t]+")


def _clean_location_line(line: str) -> str | None:
    """Strip a source-location label from one line, or return None to drop it.

    ``None`` means the line existed only to say "Slide 12" and should vanish;
    blank lines are returned untouched so paragraph structure survives.
    """
    if not line.strip():
        return line
    if _NUMBERED_LINE.match(line):
        return line
    if _ONLY_LABEL_LINE.match(line):
        return None
    match = _LABEL_PREFIX.match(line)
    if match:
        line = f"{match.group('lead')}{match.group('rest')}"
    line = _remove_trailing_tags(line)
    if not line.strip():
        return None
    return line.rstrip()


def _tidy_lines(lines: list[str]) -> list[str]:
    """Drop repeated lines and collapse runs of blank lines.

    Fenced code and table rows are left exactly as they are — a repeated line
    inside either is meaningful, not an extraction artifact.
    """
    out: list[str] = []
    in_code = False
    last_non_blank: str | None = None
    for line in lines:
        stripped = line.strip()
        fence = stripped.startswith("```") or stripped.startswith("~~~")
        if fence:
            in_code = not in_code
            out.append(line)
            last_non_blank = line
            continue
        if in_code:
            out.append(line)
            last_non_blank = line
            continue
        if not stripped:
            # Keep at most one blank line between blocks.
            if out and out[-1].strip():
                out.append("")
            continue
        if last_non_blank == line and not stripped.startswith("|"):
            continue  # an immediate repeat of what was just written
        out.append(line)
        last_non_blank = line
    return out


def strip_source_location_labels(markdown: str) -> str:
    """Remove "Slide 12" / "Page 3" extraction metadata from generated notes.

    Only source-location labels are removed. Meaningful headings, subheadings,
    definitions, formulas, tables, code blocks, numbered steps, quoted page
    references and every other piece of educational content are preserved
    exactly as written, and nothing is invented.
    """
    if not markdown:
        return markdown

    cleaned: list[str] = []
    in_code = False
    for line in markdown.split("\n"):
        stripped = line.strip()
        if stripped.startswith("```") or stripped.startswith("~~~"):
            in_code = not in_code
            cleaned.append(line)
            continue
        if in_code:
            cleaned.append(line)
            continue
        result = _clean_location_line(line)
        if result is None:
            continue
        cleaned.append(result)

    return "\n".join(_tidy_lines(cleaned))


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


def _extraction_problems(client: Client, user_id: str, scope: list[str]) -> list[str]:
    """The real, actionable extraction warnings for in-scope materials.

    Only materials that produced no *indexable* text are considered, so the
    message a user sees is the actual reason (an unsupported format, an
    unreadable file, a page with no text layer and no OCR, …) instead of a
    generic "run extraction first".
    """
    problems: list[str] = []
    for material_id in scope:
        units = extracted_unit_service.list_units(client, user_id, material_id)
        if rag_service.indexable_units(units):
            continue  # this material really does have content
        status = extraction_service.extraction_status(client, user_id, material_id)
        for warning in status.get("warnings") or []:
            if warning not in problems:
                problems.append(warning)
    return problems


def _missing_content_detail(
    client: Client, user_id: str, scope: list[str], material_id: str | None
) -> str:
    """A precise, actionable message for the "nothing to build notes from" case."""
    problems = _extraction_problems(client, user_id, scope)
    if problems:
        lead = (
            "This material has no extractable text to index yet."
            if material_id is not None
            else "These materials have no extractable text to index yet."
        )
        return f"{lead} {' '.join(problems)}"
    if _indexable_unit_count(client, user_id, scope):
        return (
            "The extracted content could not be indexed. Re-run extraction, "
            "then generate notes."
        )
    if material_id is not None:
        return (
            "This material has no extractable text to index yet. Add a file with "
            "readable text, slides or a soundtrack, then generate notes."
        )
    return (
        "No indexed content yet — add materials with readable text, slides or a "
        "soundtrack, then generate notes."
    )


def _await_extraction(client: Client, user_id: str, material_id: str) -> dict:
    """Wait (bounded) for a background extraction that is already running."""
    deadline = time.monotonic() + _PREPARE_WAIT_SECONDS
    status = extraction_service.extraction_status(client, user_id, material_id)
    while status.get("status") == "processing" and time.monotonic() < deadline:
        time.sleep(_PREPARE_POLL_SECONDS)
        status = extraction_service.extraction_status(client, user_id, material_id)
    return status


def _prepare_materials(client: Client, user_id: str, scope: list[str]) -> None:
    """Make every in-scope material extracted and indexed before note-writing.

    This is the fix for the old "Run extraction first, then generate notes"
    dead-end: the Generate action now performs any missing prerequisites itself,
    server-side, reusing the real pipeline. ``extraction_service.run_extraction``
    extracts PDFs (text + page info + images), PPT/PPTX (slide text + numbers +
    images) and videos (Whisper transcript + timestamps + frames), and then
    chunks + embeds + stores the result for retrieval.

    It deliberately avoids duplicate work:
    - an already-indexed material is left untouched;
    - a material that was extracted but not indexed is indexed from its existing
      units;
    - a material whose extraction is *still running* is waited for (the upload
      already queued it) instead of starting a second, racing run;
    - only a material with nothing extractable yet (never extracted, or a
      failed/empty earlier run) is extracted here, synchronously.
    """
    for material_id in scope:
        if rag_service.ensure_material_indexed(client, user_id, material_id):
            continue  # already indexed (this also indexes existing units)

        status = extraction_service.extraction_status(client, user_id, material_id)
        if status.get("status") == "processing":
            _await_extraction(client, user_id, material_id)
            if rag_service.ensure_material_indexed(client, user_id, material_id):
                continue

        # Nothing extractable yet: run the real pipeline, then index whatever it
        # produced. Both steps are idempotent, so a retry never duplicates rows.
        extraction_service.begin_extraction(client, user_id, material_id)
        extraction_service.run_extraction(client, user_id, material_id)
        rag_service.ensure_material_indexed(client, user_id, material_id)


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
            # Clean each partial before the merge so location labels are never
            # re-assembled into the final document.
            partials.append(strip_source_location_labels(_strip_h1(output)))
        referenced |= _referenced(output)

    body = strip_source_location_labels(_merge_partials([p for p in partials if p]))
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
    # Do not append a trailing "Sources" list; citations [#n] inside the notes
    # already point to the original material passages.
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
    """Generate and persist source-grounded notes with the configured LLM.

    The whole "make the scope ready, then write the notes" sequence runs behind
    one call, so a single Generate action is enough: any missing extraction or
    indexing is performed first (see :func:`_prepare_materials`).
    """
    owned_service.ensure_course_owned(client, user_id, course_id)
    materials = _course_materials(client, user_id, course_id)

    if material_id is not None and material_id not in materials:
        raise HTTPException(status_code=404, detail="Material not found in this course")

    scope = [material_id] if material_id is not None else sorted(materials)

    # Serialize identical requests (double clicks / two tabs): the second waits,
    # then reuses the first run's content and refreshes the same note.
    with _scope_lock(f"{user_id}:{course_id}:{material_id or '*'}"):
        return _generate_notes(
            client,
            user_id,
            course_id,
            materials,
            scope,
            material_id=material_id,
            note_id=note_id,
        )


def _generate_notes(
    client: Client,
    user_id: str,
    course_id: str,
    materials: dict[str, dict],
    scope: list[str],
    *,
    material_id: str | None,
    note_id: str | None,
) -> dict:
    """The locked body of :func:`generate_notes` (ready the scope, then write)."""
    if scope:
        _prepare_materials(client, user_id, scope)

    chunks = rag_service.list_chunks(client, user_id, course_id=course_id, material_id=material_id)

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
