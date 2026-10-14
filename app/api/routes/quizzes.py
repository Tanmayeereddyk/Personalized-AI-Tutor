"""Quiz endpoints.

Only AI *generation* lives here. Saving a manually-recorded attempt is handled
by the generic quizzes CRUD in ``app.api.routes.learning``. Generation is scoped
to a course and driven entirely by the topics the student selected — the
frontend never sends materials — and the questions are written by the same
language model already used for notes and topics (see
``app.services.quiz_service``). Every route is auth-protected and
ownership-checked, so another user's course yields 404.
"""

from fastapi import APIRouter, Depends
from supabase import Client

from app.api.dependencies import get_current_user, get_service_supabase
from app.schemas.auth import AuthUser
from app.schemas.quiz import QuizGenerateRequest, QuizGenerateResponse
from app.services import quiz_service

router = APIRouter(tags=["quiz-generation"])


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
