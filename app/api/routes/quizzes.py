"""Quiz endpoints.

AI *generation* and graded *attempts* live here; saving a manually-recorded
attempt is handled by the generic quizzes CRUD in ``app.api.routes.learning``.

Generation is scoped to a course and driven entirely by the topics the student
selected — the frontend never sends materials. The generated quiz (and its
answer key) is persisted server-side in ``public.quiz_sets`` and the browser only
receives the public questions: the correct answers are never sent before the
student submits. Submission is graded on the backend against that stored key and
saved as one row in ``public.quizzes``. Every route is auth-protected and
ownership-checked, so another user's data yields 404.
"""

from fastapi import APIRouter, Depends
from supabase import Client

from app.api.dependencies import get_current_user, get_service_supabase
from app.schemas.auth import AuthUser
from app.schemas.quiz import (
    QuizAttemptDetail,
    QuizGenerateRequest,
    QuizGenerateResponse,
    QuizResultItem,
    QuizSetResponse,
    QuizSubmitRequest,
)
from app.services import quiz_attempt_service, quiz_service

router = APIRouter(tags=["quiz-generation"])


def _attempt_detail(row: dict) -> QuizAttemptDetail:
    """Map a stored ``quizzes`` row to the reviewable attempt detail."""
    topic_ids = [str(value) for value in (row.get("topic_ids") or [])]
    topic_names = [str(value) for value in (row.get("topic_names") or [])]
    submitted_at = row.get("submitted_at")
    return QuizAttemptDetail(
        id=row["id"],
        user_id=row["user_id"],
        course_id=row["course_id"],
        quiz_set_id=row.get("quiz_set_id"),
        title=row.get("name") or "Practice quiz",
        scope_label=row.get("scope_label") or row.get("topic"),
        topic_ids=topic_ids,
        topic_names=topic_names,
        difficulty=row.get("difficulty") or "Medium",
        question_types=[str(value) for value in (row.get("question_types") or [])],
        timer_minutes=row.get("timer_minutes"),
        score=int(row.get("score") or 0),
        total=int(row.get("total") or 0),
        percentage=int(row.get("percentage") or 0),
        source=row.get("source") or ("ai" if submitted_at else "manual"),
        submitted_at=submitted_at,
        created_at=row.get("created_at"),
        results=[QuizResultItem.model_validate(item) for item in (row.get("results") or [])],
    )


@router.post(
    "/api/courses/{course_id}/quizzes/generate",
    response_model=QuizGenerateResponse,
    operation_id="quizzes_generate",
)
def generate_quiz(
    course_id: str,
    payload: QuizGenerateRequest,
    user: AuthUser = Depends(get_current_user),
    db: Client = Depends(get_service_supabase),
) -> QuizGenerateResponse:
    """Generate a quiz from the selected topics with the configured LLM."""
    result = quiz_service.generate_quiz(
        db,
        user.id,
        course_id,
        topic_ids=payload.topic_ids,
        question_count=payload.question_count,
        difficulty=payload.difficulty,
        question_types=payload.question_types,
        timer_minutes=payload.timer_minutes,
    )
    return QuizGenerateResponse.model_validate(result)


@router.get(
    "/api/quiz-sets/{set_id}",
    response_model=QuizSetResponse,
    operation_id="quiz_sets_get",
)
def get_quiz_set(
    set_id: str,
    user: AuthUser = Depends(get_current_user),
    db: Client = Depends(get_service_supabase),
) -> QuizSetResponse:
    """Re-fetch a persisted generated quiz (public questions only)."""
    row = quiz_attempt_service.get_quiz_set(db, user.id, set_id)
    return QuizSetResponse.model_validate(
        {
            "id": row["id"],
            "set_id": row["id"],
            "course_id": row["course_id"],
            "title": row.get("title") or "Practice quiz",
            "scope_label": row.get("scope_label") or "",
            "topic_ids": row.get("topic_ids") or [],
            "topic_names": row.get("topic_names") or [],
            "difficulty": row.get("difficulty") or "Medium",
            "question_types": row.get("question_types") or [],
            "timer_minutes": row.get("timer_minutes"),
            "generated_at": row.get("generated_at") or row.get("created_at"),
            "questions": row.get("questions") or [],
        }
    )


@router.post(
    "/api/quiz-sets/{set_id}/submit",
    response_model=QuizAttemptDetail,
    operation_id="quiz_sets_submit",
)
def submit_quiz(
    set_id: str,
    payload: QuizSubmitRequest,
    user: AuthUser = Depends(get_current_user),
    db: Client = Depends(get_service_supabase),
) -> QuizAttemptDetail:
    """Grade the submitted answers on the server and save the attempt."""
    row = quiz_attempt_service.submit_attempt(
        db,
        user.id,
        set_id,
        answers=[answer.model_dump() for answer in payload.answers],
        time_taken_seconds=payload.time_taken_seconds,
        client_token=payload.client_token,
    )
    return _attempt_detail(row)


@router.get(
    "/api/quizzes/{item_id}/result",
    response_model=QuizAttemptDetail,
    operation_id="quizzes_result",
)
def quiz_result(
    item_id: str,
    user: AuthUser = Depends(get_current_user),
    db: Client = Depends(get_service_supabase),
) -> QuizAttemptDetail:
    """The owner's saved attempt, with answers, answer key and explanations."""
    row = quiz_attempt_service.get_attempt(db, user.id, item_id)
    return _attempt_detail(row)
