"""Course topics (knowledge map) endpoints.

Topics are generated from a course's own indexed materials through the existing
RAG + LLM pipeline (see ``app.services.topic_service``). Every route is
auth-protected and ownership-checked, so a user can only list, generate or read
topics for their own courses; another user's ids yield 404.

The course is the scope, so the collection lives under
``/api/courses/{course_id}/topics`` and a single topic is read at
``/api/topics/{topic_id}`` — the same shape as the other course-scoped features.
"""

from fastapi import APIRouter, Depends
from supabase import Client

from app.api.dependencies import get_current_user, get_service_supabase
from app.schemas.auth import AuthUser
from app.schemas.topic import TopicResponse
from app.services import topic_service

router = APIRouter(tags=["topics"])


@router.get(
    "/api/courses/{course_id}/topics",
    response_model=list[TopicResponse],
    operation_id="topics_list",
)
def list_topics(
    course_id: str,
    user: AuthUser = Depends(get_current_user),
    db: Client = Depends(get_service_supabase),
) -> list[TopicResponse]:
    """The course's knowledge map (owner only)."""
    rows = topic_service.list_topics(db, user.id, course_id)
    return [TopicResponse.model_validate(row) for row in rows]


@router.post(
    "/api/courses/{course_id}/topics/generate",
    response_model=list[TopicResponse],
    status_code=201,
    operation_id="topics_generate",
)
def generate_topics(
    course_id: str,
    user: AuthUser = Depends(get_current_user),
    db: Client = Depends(get_service_supabase),
) -> list[TopicResponse]:
    """Generate the knowledge map from the course's indexed content.

    Re-running is safe: it refreshes the course's generated topics in place
    rather than creating duplicates.
    """
    rows = topic_service.generate_topics(db, user.id, course_id)
    return [TopicResponse.model_validate(row) for row in rows]


@router.post(
    "/api/courses/{course_id}/topics/refresh",
    response_model=list[TopicResponse],
    operation_id="topics_refresh",
)
def refresh_topics(
    course_id: str,
    user: AuthUser = Depends(get_current_user),
    db: Client = Depends(get_service_supabase),
) -> list[TopicResponse]:
    """Re-generate the knowledge map (e.g. after adding new materials)."""
    rows = topic_service.generate_topics(db, user.id, course_id)
    return [TopicResponse.model_validate(row) for row in rows]


@router.get(
    "/api/topics/{topic_id}",
    response_model=TopicResponse,
    operation_id="topics_get",
)
def get_topic(
    topic_id: str,
    user: AuthUser = Depends(get_current_user),
    db: Client = Depends(get_service_supabase),
) -> TopicResponse:
    """One topic from the knowledge map (owner only)."""
    return TopicResponse.model_validate(topic_service.get_topic(db, user.id, topic_id))
