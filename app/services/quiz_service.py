"""AI-generated practice quizzes, grounded in the course's selected topics.

When a student selects topics and clicks **Generate Quiz**, this service:

1. resolves the selected topics (owner-checked) and the materials each topic is
   drawn from (``source_material_ids``);
2. reads the *indexed* content of those materials from the existing RAG store —
   the same chunks that already power notes and the tutor;
3. asks the configured language model (``app.services.llm_service``, the exact
   same client used by notes and topics) to write the requested number of
   questions from that content only;
4. validates and repairs the model's JSON, dropping any malformed or
   ungrounded question.

There is deliberately **no** hardcoded question bank, no template and no mock
fallback: if the model is not configured or the reply cannot be turned into real
questions, the request fails with a clear error and the student can retry.
"""

from __future__ import annotations

import logging
import re
import threading
import time
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException
from supabase import Client

from app.core.config import settings
from app.services import citations, llm_service, owned_service, rag_service, topic_service

logger = logging.getLogger("studyai.quiz")

QUESTION_TYPES = ("multiple-choice", "true-false", "short-answer")
DEFAULT_MAX_QUESTIONS = 30

# Reuse the topic service's hardened JSON reader (fenced blocks, trailing commas,
# raw control characters, truncated payloads). Both features send a "one JSON
# object and nothing else" prompt, so the same repairs apply.
_json_candidates = topic_service._json_candidates
_loads = topic_service._loads

_TYPE_ALIASES: dict[str, str] = {
    "multiple-choice": "multiple-choice",
    "multiple choice": "multiple-choice",
    "multiplechoice": "multiple-choice",
    "mcq": "multiple-choice",
    "mc": "multiple-choice",
    "single-choice": "multiple-choice",
    "true-false": "true-false",
    "true/false": "true-false",
    "truefalse": "true-false",
    "tf": "true-false",
    "boolean": "true-false",
    "short-answer": "short-answer",
    "short answer": "short-answer",
    "shortanswer": "short-answer",
    "open": "short-answer",
    "text": "short-answer",
    "written": "short-answer",
}

_TRUE_TOKENS = {"true", "t", "yes", "y", "correct", "1"}
_FALSE_TOKENS = {"false", "f", "no", "n", "incorrect", "0"}

_INDEX_MARKER = re.compile(r"\d+")

_SYSTEM_PROMPT = (
    "You write exam-quality practice quizzes for one student. You create the "
    "questions using ONLY the numbered source passages in the user message.\n"
    "\n"
    "Grounding rules:\n"
    "- Every question, every answer option and every explanation must be "
    "supported by the source passages. Never use outside knowledge and never "
    "invent facts, numbers, names or definitions the passages do not state.\n"
    "- If the passages are too thin to support the requested number of "
    "questions, return as many solid questions as they support; never pad with "
    "guesswork.\n"
    "- Write fresh questions; never copy a passage verbatim as the question.\n"
    "\n"
    "Question rules:\n"
    "- `type` must be one of the requested question types.\n"
    "- `prompt` is the question text.\n"
    "- For multiple-choice, `options` is a list of 3-5 distinct, plausible "
    "choices and `correct_answer` MUST exactly equal one of them.\n"
    "- For true-false, `correct_answer` MUST be \"True\" or \"False\".\n"
    "- For short-answer, `correct_answer` is a short expected answer and "
    "`accepted_answers` may list equivalent acceptable answers.\n"
    "- `explanation` is one or two sentences saying why the answer is correct, "
    "drawn from the passages.\n"
    "- `source_indexes` lists the passage numbers (the [#n] labels) that support "
    "the question, for example [1, 4].\n"
    "- Do not repeat the same question twice.\n"
    "\n"
    "Output format — respond with ONE JSON object and nothing else (no prose, no "
    "explanations outside the JSON, no Markdown code fences):\n"
    '{"questions": [{"type": "multiple-choice", "prompt": "...", '
    '"options": ["...", "..."], "correct_answer": "...", '
    '"explanation": "...", "source_indexes": [1], "topic_id": "<provided topic id>"}]}'
)

# One in-flight generation per (user, course): a double click or two tabs must
# not fire two paid model calls for the same quiz.
_GENERATION_LOCK = threading.Lock()
_GENERATING: set[tuple[str, str]] = set()


# ----------------------------------------------------------------------
# Scope / source helpers
# ----------------------------------------------------------------------

def _course_materials(client: Client, user_id: str, course_id: str) -> dict[str, dict]:
    """Map every material in the course by id (owner only)."""
    return {
        row["id"]: row
        for row in owned_service.list_items(client, user_id, "materials", course_id=course_id)
    }


def _selected_topics(
    client: Client, user_id: str, course_id: str, topic_ids: list[str]
) -> list[dict]:
    """The selected topics that belong to this course, in the requested order."""
    rows = owned_service.list_items(client, user_id, "topics", course_id=course_id)
    by_id = {row["id"]: row for row in rows}
    selected: list[dict] = []
    seen: set[str] = set()
    for topic_id in topic_ids:
        topic = by_id.get(topic_id)
        if topic is None:
            raise HTTPException(
                status_code=404,
                detail="One or more selected topics were not found in this course.",
            )
        if topic_id not in seen:
            seen.add(topic_id)
            selected.append(topic)
    return selected


def _course_chunks(client: Client, user_id: str, course_id: str) -> list[dict]:
    """Every indexed chunk for the course, indexing existing units if needed."""
    chunks = rag_service.list_chunks(client, user_id, course_id=course_id)
    if chunks:
        return chunks

    for material_id in sorted(_course_materials(client, user_id, course_id)):
        try:
            rag_service.ensure_material_indexed(client, user_id, material_id)
        except HTTPException:
            raise
        except Exception as exc:  # noqa: BLE001 - try the remaining materials
            logger.warning("quiz: could not index material %s: %s", material_id, exc)
    return rag_service.list_chunks(client, user_id, course_id=course_id)


def _scope_chunks(
    chunks: list[dict], topics: list[dict], material_ids: set[str]
) -> list[dict]:
    """The course chunks that belong to the selected topics' materials.

    A topic knows which materials it was drawn from (``source_material_ids``).
    When any selected topic has no recorded source, every course material is
    included so the model still sees the relevant content. If filtering leaves
    nothing, the whole course scope is used rather than failing on an empty set.
    """
    selected: set[str] = set()
    for topic in topics:
        source_ids = {
            str(material_id)
            for material_id in (topic.get("source_material_ids") or [])
            if material_id
        }
        if not source_ids:
            # No provenance for this topic: fall back to the whole course scope.
            return list(chunks)
        selected |= source_ids

    scoped = [chunk for chunk in chunks if str(chunk.get("material_id")) in selected]
    return scoped or list(chunks)


def _source_text(
    chunks: list[dict], materials: dict[str, dict], budget: int
) -> tuple[str, dict[int, dict]]:
    """A numbered, delimited source block plus a ``{passage_number: chunk}`` map."""
    blocks: list[str] = []
    passage_chunks: dict[int, dict] = {}
    used = 0
    for number, chunk in enumerate(chunks, start=1):
        name = (materials.get(chunk.get("material_id")) or {}).get("name") or "Material"
        block = (
            f"[#{number}] ({name} · {citations.chunk_locator(chunk)})\n"
            f"{(chunk.get('content') or '').strip()}"
        )
        if used and used + len(block) > budget:
            break
        blocks.append(block)
        passage_chunks[number] = chunk
        used += len(block)
    return "\n\n".join(blocks), passage_chunks


def _topic_lines(topics: list[dict]) -> str:
    lines: list[str] = []
    for topic in topics:
        description = (topic.get("description") or "").strip()
        name = (topic.get("name") or "").strip() or "Topic"
        lines.append(f"- {name}: {description}" if description else f"- {name}")
    return "\n".join(lines)


# ----------------------------------------------------------------------
# Parsing / validation
# ----------------------------------------------------------------------

def _clean_text(value: object, limit: int) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text[:limit] if text else None


def _normalize_type(value: object) -> str | None:
    if value is None:
        return None
    key = str(value).strip().lower().replace("_", "-")
    if key in _TYPE_ALIASES:
        return _TYPE_ALIASES[key]
    collapsed = re.sub(r"[^a-z]", "", key)
    for alias, canonical in _TYPE_ALIASES.items():
        if re.sub(r"[^a-z]", "", alias) == collapsed:
            return canonical
    return None


def _normalize_answer(value: str | None) -> str:
    return re.sub(r"\s+", " ", (value or "").strip()).strip().lower()


def _as_options(value: object) -> list[str]:
    if not isinstance(value, (list, tuple)):
        return []
    options: list[str] = []
    for item in value:
        text = _clean_text(item, 600)
        if text and text not in options:
            options.append(text)
    return options


def _indexes(value: object) -> list[int]:
    if value is None:
        return []
    items = value if isinstance(value, (list, tuple, set)) else [value]
    numbers: list[int] = []
    for item in items:
        match = _INDEX_MARKER.search(str(item))
        if not match:
            continue
        number = int(match.group())
        if number > 0 and number not in numbers:
            numbers.append(number)
    return numbers


def _pick_correct(options: list[str], raw: dict) -> str | None:
    """Resolve the correct option from the many shapes a model may return."""
    candidate = None
    for key in ("correct_answer", "correct", "answer", "correct_option", "correctAnswer"):
        value = _clean_text(raw.get(key), 600)
        if value:
            candidate = value
            break

    if candidate:
        for option in options:
            if _normalize_answer(option) == _normalize_answer(candidate):
                return option
        return candidate  # keep it; validation will reject it if it is not an option

    for key in ("correct_index", "answer_index", "correctIndex", "correct_option_index"):
        match = _INDEX_MARKER.search(str(raw.get(key)))
        if match:
            position = int(match.group())
            if 0 <= position < len(options):
                return options[position]
            if 1 <= position <= len(options):
                return options[position - 1]
    return None


def _normalize_true_false(value: str | None) -> str | None:
    key = _normalize_answer(value)
    if key in _TRUE_TOKENS:
        return "True"
    if key in _FALSE_TOKENS:
        return "False"
    return None


def _build_question(
    raw: object,
    *,
    index: int,
    passage_chunks: dict[int, dict],
    materials: dict[str, dict],
    allowed_topic_ids: set[str],
) -> dict | None:
    """Validate one raw model entry into a question, or ``None`` if unusable."""
    if not isinstance(raw, dict):
        return None

    prompt = _clean_text(raw.get("prompt") or raw.get("question") or raw.get("text"), 1000)
    if not prompt:
        return None
    explanation = _clean_text(raw.get("explanation") or raw.get("rationale"), 1500)
    if not explanation:
        # A question without a grounded explanation is incomplete; drop it.
        return None

    qtype = _normalize_type(raw.get("type") or raw.get("question_type"))
    options = _as_options(raw.get("options") or raw.get("choices"))
    if qtype is None:
        # Infer from the shape when the model omitted a recognizable type.
        if options:
            qtype = "multiple-choice"
        elif _normalize_true_false(raw.get("correct_answer") or raw.get("answer")):
            qtype = "true-false"
        else:
            qtype = "short-answer"

    accepted: list[str] | None = None

    if qtype == "multiple-choice":
        if len(options) < 2:
            return None
        answer = _pick_correct(options, raw)
        if not answer:
            return None
        matched = next(
            (option for option in options if _normalize_answer(option) == _normalize_answer(answer)),
            None,
        )
        if matched is None:
            # The stated answer is not one of the options: unusable.
            return None
        correct = matched
    elif qtype == "true-false":
        correct = _normalize_true_false(
            _clean_text(raw.get("correct_answer") or raw.get("answer") or raw.get("correct"), 20)
        )
        if correct is None:
            return None
        options = ["True", "False"]
    else:  # short-answer
        correct = _clean_text(
            raw.get("correct_answer") or raw.get("answer") or raw.get("correct"), 600
        )
        if not correct:
            return None
        candidates = _as_options(raw.get("accepted_answers") or raw.get("accepted"))
        accepted = [value for value in candidates if _normalize_answer(value) != _normalize_answer(correct)]
        accepted = accepted or None

    source = None
    for number in _indexes(raw.get("source_indexes") or raw.get("sources") or raw.get("indexes")):
        chunk = passage_chunks.get(number)
        if chunk is None:
            continue
        source = {
            "label": citations.chunk_locator(chunk),
            "material_id": chunk.get("material_id"),
            "material_name": (materials.get(chunk.get("material_id")) or {}).get("name")
            or "Material",
            "snippet": (chunk.get("content") or "").strip()[:240],
        }
        break

    return {
        "id": f"q{index}",
        "topic_id": raw.get("topic_id") if str(raw.get("topic_id")) in allowed_topic_ids else None,
        "type": qtype,
        "prompt": prompt,
        "options": options if qtype != "short-answer" else None,
        "correct_answer": correct,
        "accepted_answers": accepted,
        "explanation": explanation,
        "source": source,
    }


def _questions_from_data(
    data: object,
    *,
    allowed_types: set[str],
    limit: int,
    passage_chunks: dict[int, dict],
    materials: dict[str, dict],
    allowed_topic_ids: set[str],
) -> list[dict]:
    """Validate raw parsed JSON into unique, complete questions."""
    if isinstance(data, dict):
        data = data.get("questions") or data.get("items") or data.get("quiz") or []
    if not isinstance(data, list):
        return []

    questions: list[dict] = []
    seen: set[str] = set()
    for raw in data:
        question = _build_question(
            raw, index=len(questions) + 1, passage_chunks=passage_chunks, materials=materials,
            allowed_topic_ids=allowed_topic_ids,
        )
        if question is None or question["type"] not in allowed_types:
            continue
        key = _normalize_answer(question["prompt"])
        if key in seen:
            continue
        seen.add(key)
        questions.append(question)
        if len(questions) >= limit:
            break
    return questions


def _parse_questions(
    raw: str,
    *,
    allowed_types: set[str],
    limit: int,
    passage_chunks: dict[int, dict],
    materials: dict[str, dict],
    allowed_topic_ids: set[str],
) -> list[dict]:
    """Turn the model's reply into validated questions, repairing common drift.

    Tries each plausible JSON substring (fenced blocks, every top-level object,
    then the whole reply) and keeps the first that yields real questions. If
    nothing does, this logs the key-free model output and fails clearly — it
    never invents questions and never falls back to a static bank.
    """
    text = (raw or "").strip()
    if not text:
        raise HTTPException(status_code=502, detail="The language model returned no questions.")

    saw_json = False
    for candidate in _json_candidates(text):
        try:
            data = _loads(candidate)
        except ValueError:
            continue
        saw_json = True
        questions = _questions_from_data(
            data,
            allowed_types=allowed_types,
            limit=limit,
            passage_chunks=passage_chunks,
            materials=materials,
            allowed_topic_ids=allowed_topic_ids,
        )
        if questions:
            return questions

    logger.warning(
        "quiz: could not read model output (json_parsed=%s): %r", saw_json, text[:500]
    )
    if saw_json:
        detail = (
            "The language model returned questions that were incomplete or not "
            "supported by the selected topics. Please try again."
        )
    else:
        detail = "The language model returned the quiz in an unreadable format. Please try again."
    raise HTTPException(status_code=502, detail=detail)


# ----------------------------------------------------------------------
# Public API
# ----------------------------------------------------------------------

def _begin_generation(user_id: str, course_id: str) -> tuple[str, str]:
    key = (user_id, course_id)
    with _GENERATION_LOCK:
        if key in _GENERATING:
            raise HTTPException(
                status_code=409,
                detail=(
                    "A quiz is already being generated for this course. "
                    "Please wait for it to finish, then try again."
                ),
            )
        _GENERATING.add(key)
    return key


def _end_generation(key: tuple[str, str]) -> None:
    with _GENERATION_LOCK:
        _GENERATING.discard(key)


def _title(topic_names: list[str]) -> str:
    if len(topic_names) == 1:
        return f"{topic_names[0]} — Practice Quiz"
    if len(topic_names) == 2:
        return f"{topic_names[0]} & {topic_names[1]} — Practice Quiz"
    return f"{topic_names[0]} + {len(topic_names) - 1} more — Practice Quiz"


def generate_quiz(
    client: Client,
    user_id: str,
    course_id: str,
    *,
    topic_ids: list[str],
    question_count: int,
    difficulty: str,
    question_types: list[str],
    timer_minutes: int | None,
) -> dict:
    """Generate a source-grounded quiz from the selected topics with the LLM."""
    owned_service.ensure_course_owned(client, user_id, course_id)
    topics = _selected_topics(client, user_id, course_id, topic_ids)

    requested_types = [
        normalized
        for normalized in (_normalize_type(t) for t in question_types)
        if normalized in QUESTION_TYPES
    ]
    allowed_types = set(requested_types) or set(QUESTION_TYPES)
    count = max(1, min(DEFAULT_MAX_QUESTIONS, int(question_count)))

    key = _begin_generation(user_id, course_id)
    try:
        chunks = _course_chunks(client, user_id, course_id)
        if not chunks:
            raise HTTPException(
                status_code=400,
                detail=(
                    "No processed content yet — wait for your materials to finish "
                    "processing, then generate a quiz."
                ),
            )

        if not llm_service.is_configured():
            raise HTTPException(status_code=503, detail=llm_service.not_configured_message())

        materials = _course_materials(client, user_id, course_id)
        scoped = _scope_chunks(chunks, topics, set(materials))
        source, passage_chunks = _source_text(
            scoped, materials, settings.RAG_QUIZ_MAX_SOURCE_CHARS
        )

        user_prompt = (
            f"Create exactly {count} "
            f"{'question' if count == 1 else 'questions'} for this practice quiz.\n"
            f"Difficulty: {difficulty}.\n"
            f"Allowed question types: {', '.join(sorted(allowed_types))}.\n\n"
            "Topics to cover:\n"
            f"{_topic_lines(topics)}\n\n"
            "For each question, include topic_id using exactly one provided topic id when supported by the source; otherwise use null.\n\n"
            "Source passages (use ONLY these; cite them by [#n]):\n"
            f"{source}"
        )

        max_tokens = min(8192, 500 + count * 240)
        try:
            started = time.perf_counter()
            raw = llm_service.complete(
                _SYSTEM_PROMPT, user_prompt, max_tokens=max_tokens, json_mode=True
            )
            logger.info("quiz: model answered in %.2fs", time.perf_counter() - started)
        except llm_service.LLMError as exc:
            raise HTTPException(status_code=502, detail=str(exc)) from exc

        questions = _parse_questions(
            raw,
            allowed_types=allowed_types,
            limit=count,
            passage_chunks=passage_chunks,
            materials=materials,
            allowed_topic_ids={str(topic["id"]) for topic in topics},
        )
    finally:
        _end_generation(key)

    topic_names = [(topic.get("name") or "").strip() or "Topic" for topic in topics]
    used_types = list(dict.fromkeys(question["type"] for question in questions))
    return {
        "id": f"quiz-{uuid.uuid4()}",
        "course_id": course_id,
        "title": _title(topic_names),
        "scope_label": " · ".join(topic_names),
        "topic_ids": [topic["id"] for topic in topics],
        "topic_names": topic_names,
        "difficulty": difficulty,
        "question_types": used_types or requested_types or list(QUESTION_TYPES),
        "timer_minutes": timer_minutes,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "questions": questions,
    }
