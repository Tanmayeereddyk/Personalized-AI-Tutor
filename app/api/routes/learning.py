"""Per-user learning data: notes, quizzes, decks, events, bookmarks.

Each resource is exposed through a small router built from the shared
ownership-safe CRUD in ``app.services.owned_service``. Because every
query filters by the authenticated user id, two different users can never
see or modify each other's rows — even when they know a record id.

Course-scoped resources (notes, quizzes, decks) live under
``/api/courses/<course_id>/<segment>`` so creating one also checks that
the course belongs to the caller. Personal resources (calendar events,
bookmarks) live at ``/api/<segment>``.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from supabase import Client

from app.api.dependencies import get_current_user, get_service_supabase
from app.schemas.auth import AuthUser
from app.schemas.learning import (
    BookmarkCreate,
    BookmarkResponse,
    BookmarkUpdate,
    DeckCreate,
    DeckResponse,
    DeckUpdate,
    EventCreate,
    EventResponse,
    EventUpdate,
    FlashcardCreate,
    FlashcardResponse,
    FlashcardUpdate,
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
        if table == "quizzes":
            answers = values.get("answers", [])
            question_ids = [answer["question_id"] for answer in answers]
            if len(question_ids) != len(set(question_ids)):
                raise HTTPException(status_code=422, detail="Duplicate question answers are not allowed")
            if any(
                (answer["answered"] and not isinstance(answer.get("is_correct"), bool))
                or (not answer["answered"] and answer.get("is_correct") is not None)
                for answer in answers
            ):
                raise HTTPException(
                    status_code=422,
                    detail="Answered questions require correctness; unanswered questions must not include it",
                )
            topic_ids = {answer["topic_id"] for answer in answers if answer.get("topic_id")}
            if topic_ids:
                for topic_id in topic_ids:
                    topic_row = (
                        db.table("topics")
                        .select("id")
                        .eq("id", topic_id)
                        .eq("user_id", user.id)
                        .eq("course_id", course_id)
                        .maybe_single()
                        .execute()
                        .data
                    )
                    if topic_row is None:
                        raise HTTPException(status_code=422, detail="Answer topics must belong to this course")
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
events_router = _user_scoped_router(
    table="calendar_events", tag="calendar-events", segment="calendar-events",
    create_model=EventCreate, update_model=EventUpdate, response_model=EventResponse,
)
bookmarks_router = _user_scoped_router(
    table="bookmarks", tag="bookmarks", segment="bookmarks",
    create_model=BookmarkCreate, update_model=BookmarkUpdate, response_model=BookmarkResponse,
)

def _flashcards_router() -> APIRouter:
    router = APIRouter(tags=['flashcards'])
    collection = '/api/decks/{deck_id}/flashcards'
    item = '/api/flashcards/{item_id}'

    @router.post(collection, response_model=FlashcardResponse, status_code=201, operation_id='flashcards_create')
    def create_card(deck_id: str, payload: FlashcardCreate, user: AuthUser = Depends(get_current_user), db: Client = Depends(get_service_supabase)):
        owned_service.ensure_deck_owned(db, user.id, deck_id)
        values = payload.model_dump()
        values['deck_id'] = deck_id
        res = owned_service.create_item(db, user.id, 'flashcards', values)
        try:
            owned_service.update_deck_card_count(db, user.id, deck_id)
        except Exception:
            pass
        return res

    @router.get(collection, response_model=list[FlashcardResponse], operation_id='flashcards_list')
    def list_cards(deck_id: str, user: AuthUser = Depends(get_current_user), db: Client = Depends(get_service_supabase)):
        owned_service.ensure_deck_owned(db, user.id, deck_id)
        return owned_service.list_items(db, user.id, 'flashcards', deck_id=deck_id, order_by='created_at')

    @router.get(item, response_model=FlashcardResponse, operation_id='flashcards_get')
    def get_card(item_id: str, user: AuthUser = Depends(get_current_user), db: Client = Depends(get_service_supabase)):
        return owned_service.get_item(db, user.id, 'flashcards', item_id)

    @router.put(item, response_model=FlashcardResponse, operation_id='flashcards_update')
    def update_card(item_id: str, payload: FlashcardUpdate, user: AuthUser = Depends(get_current_user), db: Client = Depends(get_service_supabase)):
        changes = payload.model_dump(exclude_unset=True)
        return owned_service.update_item(db, user.id, 'flashcards', item_id, changes)

    @router.delete(item, status_code=204, operation_id='flashcards_delete')
    def delete_card(item_id: str, user: AuthUser = Depends(get_current_user), db: Client = Depends(get_service_supabase)) -> Response:
        card = owned_service.get_item(db, user.id, 'flashcards', item_id)
        deck_id = card.get('deck_id')
        owned_service.delete_item(db, user.id, 'flashcards', item_id)
        try:
            if deck_id:
                owned_service.update_deck_card_count(db, user.id, deck_id)
        except Exception:
            pass
        return Response(status_code=204)

    return router


flashcards_router = _flashcards_router()
