"""Grading and persistence for submitted quiz attempts.

The answer key never reaches the browser before a student submits: the generated
quiz (with its correct answers) is stored in ``public.quiz_sets`` at generation
time, and this service grades the submitted answers against that stored key. The
score is therefore always computed on the backend and is never trusted from the
client.

Every submission is its own row in ``public.quizzes``, so retaking a quiz adds a
new history entry instead of overwriting the previous one. A client-supplied
``client_token`` makes the write idempotent: a double-click or a retried request
returns the already-saved attempt rather than creating a duplicate.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone

from fastapi import HTTPException
from supabase import Client, PostgrestAPIError


def _db_error(exc: PostgrestAPIError, *, table: str | None = None) -> HTTPException:
    """Map a Supabase failure to a clear, actionable HTTP error.

    A missing table (e.g. ``quiz_sets`` before migration 007 is applied) is the
    only thing re-running the SQL fixes, so name it; anything else is a
    transient or data problem.
    """
    code = getattr(exc, "code", None)
    if code in {"42P01", "PGRST205"}:
        target = f"The '{table}' table" if table else "A required database table"
        detail = (
            f"{target} is missing. Run database/schema.sql and the migrations in "
            "database/migrations/ in your Supabase project, then try again."
        )
    elif code in {"42703", "PGRST204"}:
        detail = (
            "A required database column is missing. Run the latest migration in "
            "database/migrations/ in your Supabase project, then try again."
        )
    else:
        detail = "Database error. Please try again."
    return HTTPException(status_code=500, detail=detail)


def _normalize(value: str | None) -> str:
    """Loose answer matching (trim + case + collapsed whitespace)."""
    return re.sub(r"\s+", " ", (value or "").strip()).strip().lower()


def _is_correct(question: dict, answer: str) -> bool:
    if not answer or not answer.strip():
        return False
    correct = question.get("correct_answer") or ""
    if question.get("type") == "short-answer":
        candidates = [correct, *(c for c in (question.get("accepted_answers") or []) if c)]
        return any(_normalize(c) == _normalize(answer) for c in candidates)
    return _normalize(answer) == _normalize(correct)


def _public_source(question: dict) -> dict | None:
    source = question.get("source")
    if not isinstance(source, dict):
        return None
    return {
        "label": source.get("label") or "",
        "material_id": source.get("material_id"),
        "material_name": source.get("material_name") or "Material",
    }


def grade(questions: list[dict], answers: list[dict]) -> tuple[list[dict], int]:
    """Return the per-question results and the number of correct answers.

    ``questions`` is the stored answer key; ``answers`` are the submitted
    ``{question_id, answer}`` entries. Unanswered questions count as wrong.
    """
    given = {
        str(entry.get("question_id")): (entry.get("answer") or "")
        for entry in answers
        if entry.get("question_id") is not None
    }
    results: list[dict] = []
    score = 0
    for question in questions:
        question_id = str(question.get("id"))
        answer = given.get(question_id, "")
        correct = _is_correct(question, answer)
        if correct:
            score += 1
        results.append(
            {
                "id": question_id,
                "type": question.get("type") or "short-answer",
                "prompt": question.get("prompt") or "",
                "options": question.get("options"),
                "given": answer,
                "correct": correct,
                "correct_answer": question.get("correct_answer") or "",
                "explanation": question.get("explanation") or "",
                "source": _public_source(question),
            }
        )
    return results, score


def _fetch_one(client: Client, table: str, **filters: object) -> dict | None:
    query = client.table(table).select("*")
    for column, value in filters.items():
        query = query.eq(column, value)
    try:
        result = query.maybe_single().execute()
    except PostgrestAPIError as exc:
        raise _db_error(exc, table=table) from exc
    return getattr(result, "data", None)


def get_quiz_set(client: Client, user_id: str, set_id: str) -> dict:
    """The owner's generated quiz (with its private answer key), or 404."""
    row = _fetch_one(client, "quiz_sets", id=set_id, user_id=user_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Quiz not found")
    return row


def get_attempt(client: Client, user_id: str, attempt_id: str) -> dict:
    """The owner's saved attempt, repairing legacy AI result detail if needed."""
    row = _fetch_one(client, "quizzes", id=attempt_id, user_id=user_id)
    if row is None:
        raise HTTPException(status_code=404, detail="Not found")
    # Older generated attempts predate the persisted ``results`` payload and
    # sometimes have no ``source`` marker. Their quiz_set_id is authoritative:
    # it is written only by the server-side AI submit flow. Re-grade from that
    # owner-scoped set so those students can still open their saved quiz.
    if row.get("quiz_set_id") and not row.get("results"):
        quiz_set = get_quiz_set(client, user_id, str(row["quiz_set_id"]))
        questions = quiz_set.get("questions")
        answers = row.get("answers")
        if isinstance(questions, list) and isinstance(answers, dict):
            answer_rows = [
                {"question_id": question_id, "answer": answer}
                for question_id, answer in answers.items()
            ]
            results, _score = grade(questions, answer_rows)
            return {**row, "source": row.get("source") or "ai", "results": results}
    return row


def find_by_token(client: Client, user_id: str, token: str | None) -> dict | None:
    """The already-saved attempt for an idempotency token, if any."""
    if not token:
        return None
    return _fetch_one(client, "quizzes", user_id=user_id, client_token=token)


def submit_attempt(
    client: Client,
    user_id: str,
    set_id: str,
    *,
    answers: list[dict],
    time_taken_seconds: int | None,
    client_token: str | None,
) -> dict:
    """Grade and save one submission, returning the stored attempt row.

    Idempotent on ``client_token``: a repeated request (double-click, retry after
    a network failure) returns the row created the first time.
    """
    existing = find_by_token(client, user_id, client_token)
    if existing is not None:
        return existing

    quiz_set = get_quiz_set(client, user_id, set_id)
    questions = quiz_set.get("questions")
    if not isinstance(questions, list) or not questions:
        raise HTTPException(
            status_code=409,
            detail="This quiz can no longer be graded. Please generate it again.",
        )

    results, score = grade(questions, answers)
    question_count = len(questions)
    percentage = round((score / question_count) * 100) if question_count else 0
    topic_names = [str(name) for name in (quiz_set.get("topic_names") or [])]

    values = {
        "course_id": quiz_set.get("course_id"),
        "quiz_set_id": set_id,
        "name": quiz_set.get("title") or "Practice quiz",
        "topic": quiz_set.get("scope_label") or (topic_names[0] if topic_names else None),
        "difficulty": quiz_set.get("difficulty") or "Medium",
        "score": score,
        "total": question_count,
        "percentage": percentage,
        "answers": {
            str(entry.get("question_id")): (entry.get("answer") or "") for entry in answers
        },
        "results": results,
        "topic_ids": quiz_set.get("topic_ids") or [],
        "topic_names": topic_names,
        "scope_label": quiz_set.get("scope_label"),
        "question_types": quiz_set.get("question_types") or [],
        "timer_minutes": quiz_set.get("timer_minutes"),
        "time_taken_seconds": time_taken_seconds,
        "source": "ai",
        "submitted_at": datetime.now(timezone.utc).isoformat(),
        "client_token": client_token,
    }

    try:
        result = client.table("quizzes").insert({**values, "user_id": user_id}).execute()
    except PostgrestAPIError as exc:
        # A concurrent double-submit may have won the unique (user_id,
        # client_token) guard between our lookup and this insert; if so, return
        # that row instead of failing the request.
        existing = find_by_token(client, user_id, client_token)
        if existing is not None:
            return existing
        raise _db_error(exc, table="quizzes") from exc

    if not result.data:
        raise HTTPException(status_code=500, detail="Could not save the quiz attempt")
    return result.data[0]
