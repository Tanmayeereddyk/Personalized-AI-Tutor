"""Course knowledge map: AI-generated topics grounded in the RAG index.

Topics are produced by the configured language model from the *indexed* content
of a course's materials — the same chunk index that already powers notes and the
tutor (``rag_service``). Nothing outside the course's own materials is used, and
the model is asked to return a strict JSON list so the result can be validated
before it is stored.

Design notes
------------
- Reuses the existing AI/RAG pipeline; there is no separate retrieval or
  generation path.
- Every generated topic is de-duplicated case-insensitively and then written
  through the ordinary, ownership-safe CRUD, so a course can never accumulate
  two topics with the same name. Re-generating refreshes the course's generated
  topics in place (updating existing rows, adding new ones and removing stale
  generated ones) instead of piling up duplicates. Topics a user created by hand
  (``generated`` is false) are never touched.
- There is deliberately **no** template/extractive fallback: an empty course or
  an unindexed course fails with an actionable message, and an unavailable model
  fails with a clear error, rather than inventing topics.
"""

from __future__ import annotations

import ast
import json
import logging
import re
import threading
import time
from collections.abc import Iterator

from fastapi import HTTPException
from supabase import Client

from app.core.config import settings
from app.services import llm_service, owned_service, rag_service

logger = logging.getLogger("studyai.topics")

TABLE = "topics"
GENERATION_METHOD = "llm"

_FENCED_JSON = re.compile(r"```(?:json)?\s*(.*?)```", re.DOTALL)
_TRAILING_COMMA = re.compile(r",(\s*[}\]])")

_SYSTEM_PROMPT = (
    "You build a concise, accurate knowledge map (topic list) for ONE course, "
    "using ONLY the numbered source passages the user provides.\n"
    "\n"
    "Grounding rules:\n"
    "- Every topic, term, fact and number must come from the source passages. "
    "Never use outside knowledge and never invent anything the passages do not "
    "support.\n"
    "- Only return topics the passages actually cover with substance; skip terms "
    "that are merely mentioned in passing.\n"
    "- Merge duplicate or substantially overlapping topics into one.\n"
    "- Keep every `name` short (roughly 2-6 words) and meaningful.\n"
    "\n"
    "Topic structure:\n"
    "- `name`: the topic name.\n"
    "- `description`: ONE short sentence grounded in the passages.\n"
    "- `topic_group`: an optional higher-level theme. Represent a subtopic by "
    "giving it the same `topic_group` as the broader topic it belongs to.\n"
    "- `prerequisite`: the earlier topic `name` this one builds on, ONLY when the "
    "passages clearly imply that ordering.\n"
    "- `source_indexes`: the passage numbers (the [#n] labels) this topic is drawn "
    "from, for example [1, 4].\n"
    "- Never return two topics with the same name (ignoring case).\n"
    f"- Return at most {settings.RAG_TOPICS_MAX} topics.\n"
    "\n"
    "Output format — respond with ONE JSON object and nothing else (no prose, no "
    "explanations, no Markdown code fences):\n"
    '{"topics": [{"name": "...", "description": "...", "topic_group": "...", '
    '"prerequisite": "...", "source_indexes": [1]}]}'
)

# One in-flight generation per (user, course): the automatic post-extraction
# refresh and an explicit click must never run the same course at once and
# produce duplicate rows or duplicate model calls.
_GENERATION_LOCK = threading.Lock()
_GENERATING: set[tuple[str, str]] = set()


# ----------------------------------------------------------------------
# Scope helpers
# ----------------------------------------------------------------------

def _course_materials(client: Client, user_id: str, course_id: str) -> dict[str, dict]:
    """Map every material in the course by id (owner only)."""
    return {
        row["id"]: row
        for row in owned_service.list_items(client, user_id, "materials", course_id=course_id)
    }


def _course_chunks(client: Client, user_id: str, course_id: str) -> list[dict]:
    """Every indexed chunk for the course, building the index if needed."""
    chunks = rag_service.list_chunks(client, user_id, course_id=course_id)
    if chunks:
        return chunks

    # The course's materials may be extracted but not indexed yet (for example
    # an older upload). Build the index from the existing extracted units so
    # topics can still be grounded in real content instead of failing.
    for material_id in sorted(_course_materials(client, user_id, course_id)):
        try:
            rag_service.ensure_material_indexed(client, user_id, material_id)
        except HTTPException:
            raise
        except Exception as exc:  # noqa: BLE001 - try the remaining materials
            logger.warning("topics: could not index material %s: %s", material_id, exc)
    return rag_service.list_chunks(client, user_id, course_id=course_id)


def _source_text(
    chunks: list[dict], materials: dict[str, dict], budget: int
) -> tuple[str, dict[int, str]]:
    """A numbered, clearly-delimited source block within a character budget.

    Returns the block and a ``{passage_number: material_id}`` map, so a topic the
    model attributes to passages ``[#n]`` can be traced back to real materials.
    """
    blocks: list[str] = []
    passage_materials: dict[int, str] = {}
    used = 0
    for number, chunk in enumerate(chunks, start=1):
        name = (materials.get(chunk.get("material_id")) or {}).get("name") or "Material"
        block = f"[#{number}] ({name})\n{(chunk.get('content') or '').strip()}"
        if used and used + len(block) > budget:
            break
        blocks.append(block)
        material_id = str(chunk.get("material_id") or "")
        if material_id:
            passage_materials[number] = material_id
        used += len(block)
    return "\n\n".join(blocks), passage_materials


# ----------------------------------------------------------------------
# Parsing
# ----------------------------------------------------------------------

def _clean_text(value: object, limit: int) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    return text[:limit]


def _clean_indexes(value: object) -> list[int]:
    """The passage numbers a topic cites, from whatever shape the model sent."""
    if isinstance(value, (int, float)):
        value = [value]
    if not isinstance(value, (list, tuple, set)):
        return []
    numbers: list[int] = []
    for item in value:
        # Accept "3", "#3", 3.0 and comparable loose forms.
        match = re.search(r"\d+", str(item))
        if not match:
            continue
        number = int(match.group())
        if number > 0 and number not in numbers:
            numbers.append(number)
    return numbers


def _balanced_from(text: str, start: int) -> str | None:
    """The ``{...}``/``[...]`` block that starts at ``start``, or ``None``.

    Tracks string literals and escapes so brackets inside a description never
    fool the scan. Returns ``None`` if the block is never closed (truncated).
    """
    opener = text[start]
    closer = "}" if opener == "{" else "]"
    depth = 0
    in_string = False
    escape = False
    for index in range(start, len(text)):
        char = text[index]
        if in_string:
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char == opener:
            depth += 1
        elif char == closer:
            depth -= 1
            if depth == 0:
                return text[start : index + 1]
    return None


def _iter_blocks(text: str) -> Iterator[str]:
    """Every top-level ``{...}``/``[...]`` block in the text, in order.

    Scanning for *all* top-level blocks (not just the first bracket) is what lets
    us ignore a stray citation like ``[1]`` before the real JSON payload.
    """
    index = 0
    length = len(text)
    while index < length:
        char = text[index]
        if char in "{[":
            block = _balanced_from(text, index)
            if block is not None:
                yield block
                index += len(block)
                continue
        index += 1


def _escape_control_chars(text: str) -> str:
    """Escape raw newlines/tabs/control characters that sit inside JSON strings.

    Models frequently emit a multi-line description with a literal newline, which
    is invalid JSON. Escaping it (only inside strings) makes the payload valid.
    """
    out: list[str] = []
    in_string = False
    escape = False
    for char in text:
        if in_string:
            if escape:
                escape = False
                out.append(char)
                continue
            if char == "\\":
                escape = True
                out.append(char)
                continue
            if char == '"':
                in_string = False
                out.append(char)
                continue
            if char == "\n":
                out.append("\\n")
                continue
            if char == "\r":
                out.append("\\r")
                continue
            if char == "\t":
                out.append("\\t")
                continue
            if ord(char) < 0x20:
                out.append(" ")
                continue
            out.append(char)
        else:
            if char == '"':
                in_string = True
            out.append(char)
    return "".join(out)


def _repair_json(text: str) -> str:
    """Safe, common model-output repairs before a final ``json.loads``."""
    return _TRAILING_COMMA.sub(r"\1", _escape_control_chars(text))


def _close_open_brackets(text: str) -> str:
    """Append the brackets a truncated response is missing (so we can salvage it)."""
    stack: list[str] = []
    in_string = False
    escape = False
    for char in text:
        if in_string:
            if escape:
                escape = False
            elif char == "\\":
                escape = True
            elif char == '"':
                in_string = False
            continue
        if char == '"':
            in_string = True
        elif char in "{[":
            stack.append(char)
        elif char in "}]" and stack:
            stack.pop()
    if in_string:
        text += '"'
    closers = {"{": "}", "[": "]"}
    return text + "".join(closers[opener] for opener in reversed(stack))


def _loads(candidate: str) -> object:
    """Parse a JSON candidate, repairing what we safely can. Raises ValueError."""
    for attempt in (
        candidate,
        _repair_json(candidate),
        _close_open_brackets(_repair_json(candidate)),
    ):
        try:
            return json.loads(attempt)
        except ValueError:
            continue
    # Python-style literals (single quotes) are safe to read without evaluation.
    try:
        return ast.literal_eval(candidate)
    except (ValueError, SyntaxError) as exc:
        raise ValueError("not valid JSON") from exc


def _json_candidates(text: str) -> Iterator[str]:
    """Distinct substrings worth trying as JSON, most likely first."""
    seen: set[str] = set()

    def add(value: str) -> str | None:
        value = value.strip()
        if value and value not in seen:
            seen.add(value)
            return value
        return None

    for match in _FENCED_JSON.finditer(text):
        fenced = add(match.group(1))
        if fenced:
            yield fenced
    for block in _iter_blocks(text):
        found = add(block)
        if found:
            yield found
    whole = add(text)
    if whole:
        yield whole


def _entries_from_data(data: object) -> list[dict]:
    """Validate raw parsed JSON into unique, non-empty topics (never raw text)."""
    if isinstance(data, dict):
        data = data.get("topics") or data.get("items") or []
    if not isinstance(data, list):
        return []

    entries: list[dict] = []
    seen: set[str] = set()
    for item in data:
        if isinstance(item, str):
            name = _clean_text(item, 300)
            description = topic_group = prerequisite = None
            source_indexes: list[int] = []
        elif isinstance(item, dict):
            name = _clean_text(
                item.get("name") or item.get("title") or item.get("topic"), 300
            )
            description = _clean_text(item.get("description"), 1000)
            topic_group = _clean_text(item.get("topic_group") or item.get("group"), 200)
            prerequisite = _clean_text(item.get("prerequisite"), 200)
            source_indexes = _clean_indexes(
                item.get("source_indexes")
                or item.get("sources")
                or item.get("indexes")
            )
        else:
            continue
        if not name:
            continue
        key = name.lower()
        if key in seen:
            continue
        seen.add(key)
        entries.append(
            {
                "name": name,
                "description": description,
                "topic_group": topic_group,
                "prerequisite": prerequisite,
                "source_indexes": source_indexes,
            }
        )
        if len(entries) >= settings.RAG_TOPICS_MAX:
            break
    return entries


def _parse_entries(raw: str) -> list[dict]:
    """Turn the model's reply into a validated list of unique topics.

    Tries each plausible JSON substring (fenced blocks, every top-level
    ``{...}``/``[...]`` block, then the whole reply), repairing the common ways
    models drift from strict JSON. The first candidate that yields real topics
    wins. If nothing does, this logs the key-free model output for diagnosis and
    fails with one clear, actionable message — it never invents topics and never
    stores raw text.
    """
    text = (raw or "").strip()
    if not text:
        raise HTTPException(
            status_code=502, detail="The language model returned no topics."
        )

    saw_json = False
    for candidate in _json_candidates(text):
        try:
            data = _loads(candidate)
        except ValueError:
            continue
        saw_json = True
        entries = _entries_from_data(data)
        if entries:
            return entries

    logger.warning(
        "topics: could not read model output (json_parsed=%s): %r",
        saw_json,
        text[:500],
    )
    detail = (
        "The language model did not return any topics for this course."
        if saw_json
        else "The language model returned topics in an unreadable format."
    )
    raise HTTPException(status_code=502, detail=detail)


def _resource_counts(chunks: list[dict], names: list[str]) -> dict[str, int]:
    """How many distinct materials each topic name actually appears in."""
    keys = [name.lower() for name in names]
    per_topic: dict[str, set[str]] = {key: set() for key in keys}
    for chunk in chunks:
        content = (chunk.get("content") or "").lower()
        if not content:
            continue
        material_id = str(chunk.get("material_id"))
        for key in keys:
            if key and key in content:
                per_topic[key].add(material_id)
    return {key: len(materials) for key, materials in per_topic.items()}


# ----------------------------------------------------------------------
# Public API
# ----------------------------------------------------------------------

def list_topics(client: Client, user_id: str, course_id: str) -> list[dict]:
    """The course's knowledge map, owner only (404 for a foreign course)."""
    owned_service.ensure_course_owned(client, user_id, course_id)
    rows = owned_service.list_items(client, user_id, TABLE, course_id=course_id)
    return sorted(rows, key=lambda row: (row.get("name") or "").lower())


def get_topic(client: Client, user_id: str, topic_id: str) -> dict:
    """One of the user's topics, or 404."""
    return owned_service.get_item(client, user_id, TABLE, topic_id)


def _begin_generation(user_id: str, course_id: str) -> tuple[str, str]:
    """Reserve the (user, course) generation slot, or 409 if one is in flight."""
    key = (user_id, course_id)
    with _GENERATION_LOCK:
        if key in _GENERATING:
            raise HTTPException(
                status_code=409,
                detail=(
                    "Topics are already being generated for this course. "
                    "Please wait for that to finish, then try again."
                ),
            )
        _GENERATING.add(key)
    return key


def _end_generation(key: tuple[str, str]) -> None:
    with _GENERATION_LOCK:
        _GENERATING.discard(key)


def generate_topics(client: Client, user_id: str, course_id: str) -> list[dict]:
    """Generate (or refresh) the course's knowledge map from its indexed content.

    Idempotent: generating again for the same course updates the existing
    generated topics by name, adds newly covered ones and removes generated
    topics that are no longer supported, so repeated runs never duplicate rows.

    Only one generation runs per course at a time, so a manual click and the
    automatic post-extraction refresh can never race each other.
    """
    owned_service.ensure_course_owned(client, user_id, course_id)
    key = _begin_generation(user_id, course_id)
    try:
        return _generate_topics_locked(client, user_id, course_id)
    finally:
        _end_generation(key)


def _generate_topics_locked(
    client: Client, user_id: str, course_id: str
) -> list[dict]:
    materials = _course_materials(client, user_id, course_id)
    if not materials:
        raise HTTPException(
            status_code=400,
            detail="Add materials to this course, then generate topics.",
        )

    chunks = _course_chunks(client, user_id, course_id)
    if not chunks:
        raise HTTPException(
            status_code=400,
            detail=(
                "No processed content yet — wait for your materials to finish "
                "processing, then generate topics."
            ),
        )

    if not llm_service.is_configured():
        raise HTTPException(status_code=503, detail=llm_service.not_configured_message())

    source, passage_materials = _source_text(
        chunks, materials, settings.RAG_TOPICS_MAX_SOURCE_CHARS
    )
    user_prompt = (
        "Build the knowledge map JSON for this course from its source passages "
        "below (each is labelled [#n]).\n\n"
        f"{source}\n\n"
        f"Return at most {settings.RAG_TOPICS_MAX} topics."
    )

    try:
        started = time.perf_counter()
        raw = llm_service.complete(
            _SYSTEM_PROMPT, user_prompt, max_tokens=2048, json_mode=True
        )
        logger.info("topics: model answered in %.2fs", time.perf_counter() - started)
    except llm_service.LLMError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    entries = _parse_entries(raw)

    scope_material_ids = sorted(
        {str(chunk["material_id"]) for chunk in chunks if chunk.get("material_id")}
    )
    counts = _resource_counts(chunks, [entry["name"] for entry in entries])

    existing = owned_service.list_items(client, user_id, TABLE, course_id=course_id)
    by_name = {(row.get("name") or "").strip().lower(): row for row in existing}

    saved: list[dict] = []
    kept: set[str] = set()
    for entry in entries:
        key = entry["name"].lower()
        kept.add(key)
        # Prefer the exact materials the model cited (via [#n] passages); fall
        # back to the whole course scope when it did not attribute a topic.
        cited = {
            str(passage_materials[number])
            for number in entry.get("source_indexes", [])
            if number in passage_materials
        }
        values = {
            "course_id": course_id,
            "name": entry["name"],
            "description": entry["description"],
            "topic_group": entry["topic_group"],
            "prerequisite": entry["prerequisite"],
            "resource_count": counts.get(key, 0),
            "source_material_ids": sorted(cited) if cited else scope_material_ids,
            "generated": True,
            "generation_method": GENERATION_METHOD,
        }
        row = by_name.get(key)
        if row is not None:
            saved.append(
                owned_service.update_item(client, user_id, TABLE, row["id"], values)
            )
        else:
            saved.append(owned_service.create_item(client, user_id, TABLE, values))

    # Drop generated topics that are no longer supported; keep manual ones.
    for key, row in by_name.items():
        if key in kept or not row.get("generated"):
            continue
        owned_service.delete_item(client, user_id, TABLE, row["id"])

    return sorted(saved, key=lambda row: (row.get("name") or "").lower())
