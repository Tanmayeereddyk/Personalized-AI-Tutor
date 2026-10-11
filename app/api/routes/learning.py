"""Per-user learning data: notes, quizzes, decks, assessments, events, bookmarks.

Each resource is exposed through a small router built from the shared
ownership-safe CRUD in ``app.services.owned_service``. Because every
query filters by the authenticated user id, two different users can never
see or modify each other's rows — even when they know a record id.

Course-scoped resources (notes, quizzes, decks, assessments) live under
``/api/courses/<course_id>/<segment>`` so creating one also checks that
the course belongs to the caller. Personal resources (calendar events,
bookmarks) live at ``/api/<segment>``.
"""

from fastapi import APIRouter, Depends, Query, Response
from supabase import Client

from app.api.dependencies import get_current_user, get_service_supabase
from app.schemas.auth import AuthUser
from app.schemas.learning import (
    AssessmentCreate,
    AssessmentResponse,
    AssessmentUpdate,
    BookmarkCreate,
    BookmarkResponse,
    BookmarkUpdate,
    DeckCreate,
    DeckResponse,
    DeckUpdate,
    EventCreate,
    EventResponse,
    EventUpdate,
    NoteCreate,
    NoteResponse,
    NoteUpdate,
    QuizCreate,
    QuizResponse,
    QuizUpdate,
)
from app.services import owned_service


def _course_scoped_router(
    *, table: str, tag: str, segment: str, create_model, update_model, response_model
) -> APIRouter:
    """CRUD rooted at /api/courses/{course_id}/<segment>."""
    router = APIRouter(tags=[tag])
    collection = f"/api/courses/{{course_id}}/{segment}"
    item = f"/api/{segment}/{{item_id}}"

    @router.post(
        collection,
        response_model=response_model,
        status_code=201,
        operation_id=f"{table}_create",
    )
    def create(
        course_id: str,
        payload: create_model,  # type: ignore[valid-type]
        user: AuthUser = Depends(get_current_user),
        db: Client = Depends(get_service_supabase),
    ):
        owned_service.ensure_course_owned(db, user.id, course_id)
        values = payload.model_dump()
        values["course_id"] = course_id
        return owned_service.create_item(db, user.id, table, values)

    @router.get(
        collection,
        response_model=list[response_model],
        operation_id=f"{table}_list",
    )
    def list_items(
        course_id: str,
        user: AuthUser = Depends(get_current_user),
        db: Client = Depends(get_service_supabase),
    ):
        owned_service.ensure_course_owned(db, user.id, course_id)
        return owned_service.list_items(db, user.id, table, course_id=course_id)

    @router.get(
        item, response_model=response_model, operation_id=f"{table}_get"
    )
    def get_item(
        item_id: str,
        user: AuthUser = Depends(get_current_user),
        db: Client = Depends(get_service_supabase),
    ):
        return owned_service.get_item(db, user.id, table, item_id)

    @router.put(
        item, response_model=response_model, operation_id=f"{table}_update"
    )
    def update_item(
        item_id: str,
        payload: update_model,  # type: ignore[valid-type]
        user: AuthUser = Depends(get_current_user),
        db: Client = Depends(get_service_supabase),
    ):
        changes = payload.model_dump(exclude_unset=True)
        return owned_service.update_item(db, user.id, table, item_id, changes)

    @router.delete(item, status_code=204, operation_id=f"{table}_delete")
    def delete_item(
        item_id: str,
        user: AuthUser = Depends(get_current_user),
        db: Client = Depends(get_service_supabase),
    ) -> Response:
        owned_service.delete_item(db, user.id, table, item_id)
        return Response(status_code=204)

    return router


def _user_scoped_router(
    *, table: str, tag: str, segment: str, create_model, update_model, response_model
) -> APIRouter:
    """CRUD rooted at /api/<segment> for personal resources."""
    router = APIRouter(tags=[tag])
    collection = f"/api/{segment}"
    item = f"/api/{segment}/{{item_id}}"

    @router.post(
        collection,
        response_model=response_model,
        status_code=201,
        operation_id=f"{table}_create",
    )
    def create(
        payload: create_model,  # type: ignore[valid-type]
        user: AuthUser = Depends(get_current_user),
        db: Client = Depends(get_service_supabase),
    ):
        values = payload.model_dump()
        course_id = values.get("course_id")
        if course_id:
            owned_service.ensure_course_owned(db, user.id, course_id)
        return owned_service.create_item(db, user.id, table, values)

    @router.get(
        collection,
        response_model=list[response_model],
        operation_id=f"{table}_list",
    )
    def list_items(
        user: AuthUser = Depends(get_current_user),
        db: Client = Depends(get_service_supabase),
        course_id: str | None = Query(default=None),
    ):
        return owned_service.list_items(db, user.id, table, course_id=course_id)

    @router.get(
        item, response_model=response_model, operation_id=f"{table}_get"
    )
    def get_item(
        item_id: str,
        user: AuthUser = Depends(get_current_user),
        db: Client = Depends(get_service_supabase),
    ):
        return owned_service.get_item(db, user.id, table, item_id)

    @router.put(
        item, response_model=response_model, operation_id=f"{table}_update"
    )
    def update_item(
        item_id: str,
        payload: update_model,  # type: ignore[valid-type]
        user: AuthUser = Depends(get_current_user),
        db: Client = Depends(get_service_supabase),
    ):
        changes = payload.model_dump(exclude_unset=True)
        course_id = changes.get("course_id")
        if course_id:
            owned_service.ensure_course_owned(db, user.id, course_id)
        return owned_service.update_item(db, user.id, table, item_id, changes)

    @router.delete(item, status_code=204, operation_id=f"{table}_delete")
    def delete_item(
        item_id: str,
        user: AuthUser = Depends(get_current_user),
        db: Client = Depends(get_service_supabase),
    ) -> Response:
        owned_service.delete_item(db, user.id, table, item_id)
        return Response(status_code=204)

    return router


notes_router = _course_scoped_router(
    table="notes", tag="notes", segment="notes",
    create_model=NoteCreate, update_model=NoteUpdate, response_model=NoteResponse,
)
quizzes_router = _course_scoped_router(
    table="quizzes", tag="quizzes", segment="quizzes",
    create_model=QuizCreate, update_model=QuizUpdate, response_model=QuizResponse,
)
decks_router = _course_scoped_router(
    table="flashcard_decks", tag="flashcard-decks", segment="flashcard-decks",
    create_model=DeckCreate, update_model=DeckUpdate, response_model=DeckResponse,
)
assessments_router = _course_scoped_router(
    table="assessments", tag="assessments", segment="assessments",
    create_model=AssessmentCreate, update_model=AssessmentUpdate, response_model=AssessmentResponse,
)
events_router = _user_scoped_router(
    table="calendar_events", tag="calendar-events", segment="calendar-events",
    create_model=EventCreate, update_model=EventUpdate, response_model=EventResponse,
)
bookmarks_router = _user_scoped_router(
    table="bookmarks", tag="bookmarks", segment="bookmarks",
    create_model=BookmarkCreate, update_model=BookmarkUpdate, response_model=BookmarkResponse,
)
