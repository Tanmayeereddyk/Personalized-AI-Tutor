"""Schemas for per-user learning data.

These mirror the tables in database/schema.sql. ``user_id`` is always set
by the server from the authenticated token and never accepted from the
request body, so a client cannot claim someone else's rows.
"""

from pydantic import BaseModel, Field


# ------------------------------------------------------------------
# NOTES
# ------------------------------------------------------------------
class NoteCreate(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    content: str | None = Field(default=None, max_length=200_000)
    topics: list[str] = Field(default_factory=list)


class NoteUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    content: str | None = Field(default=None, max_length=200_000)
    topics: list[str] | None = None


class NoteResponse(BaseModel):
    id: str
    user_id: str
    course_id: str
    title: str
    content: str | None = None
    topics: list[str] = Field(default_factory=list)
    # RAG provenance: which materials a generated note came from and the exact
    # source references it cites. Empty for notes written by hand.
    source_material_ids: list[str] = Field(default_factory=list)
    source_refs: list[dict] = Field(default_factory=list)
    generated: bool = False
    generation_method: str | None = None
    created_at: str | None = None
    updated_at: str | None = None


# ------------------------------------------------------------------
# QUIZZES
# ------------------------------------------------------------------
class QuizCreate(BaseModel):
    name: str = Field(min_length=1, max_length=300)
    topic: str | None = Field(default=None, max_length=200)
    difficulty: str = Field(default="Medium", max_length=20)
    score: int = Field(default=0, ge=0)
    total: int = Field(default=0, ge=0)


class QuizUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=300)
    topic: str | None = Field(default=None, max_length=200)
    difficulty: str | None = Field(default=None, max_length=20)
    score: int | None = Field(default=None, ge=0)
    total: int | None = Field(default=None, ge=0)


class QuizResponse(BaseModel):
    """A quiz attempt. AI attempts carry the extra attempt metadata; manually
    recorded ones simply leave it at the defaults."""

    id: str
    user_id: str
    course_id: str
    name: str
    topic: str | None = None
    difficulty: str = "Medium"
    score: int = 0
    total: int = 0
    # Legacy or externally written rows may not have a recorded score.
    percentage: int | None = None
    quiz_set_id: str | None = None
    scope_label: str | None = None
    # Null means the attempt's provenance was not recorded.
    source: str | None = None
    submitted_at: str | None = None
    created_at: str | None = None
    updated_at: str | None = None


# ------------------------------------------------------------------
# FLASHCARD DECKS
# ------------------------------------------------------------------
class DeckCreate(BaseModel):
    topic: str = Field(default="General", max_length=200)
    card_count: int = Field(default=0, ge=0)


class DeckUpdate(BaseModel):
    topic: str | None = Field(default=None, max_length=200)
    card_count: int | None = Field(default=None, ge=0)


class DeckResponse(BaseModel):
    id: str
    user_id: str
    course_id: str
    topic: str = "General"
    card_count: int = 0
    created_at: str | None = None
    updated_at: str | None = None


# ------------------------------------------------------------------
# CALENDAR EVENTS
# ------------------------------------------------------------------
class EventCreate(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    event_date: str = Field(min_length=1, max_length=32)
    start_time: str | None = Field(default=None, max_length=16)
    end_time: str | None = Field(default=None, max_length=16)
    description: str | None = Field(default=None, max_length=2000)
    kind: str | None = Field(default=None, max_length=32)
    course_id: str | None = None


class EventUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    event_date: str | None = Field(default=None, min_length=1, max_length=32)
    start_time: str | None = Field(default=None, max_length=16)
    end_time: str | None = Field(default=None, max_length=16)
    description: str | None = Field(default=None, max_length=2000)
    kind: str | None = Field(default=None, max_length=32)
    course_id: str | None = None


class EventResponse(BaseModel):
    id: str
    user_id: str
    course_id: str | None = None
    title: str
    event_date: str
    start_time: str | None = None
    end_time: str | None = None
    description: str | None = None
    kind: str | None = None
    created_at: str | None = None
    updated_at: str | None = None


# ------------------------------------------------------------------
# BOOKMARKS
# ------------------------------------------------------------------
class BookmarkCreate(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    url: str | None = Field(default=None, max_length=2000)
    note: str | None = Field(default=None, max_length=2000)
    course_id: str | None = None


class BookmarkUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    url: str | None = Field(default=None, max_length=2000)
    note: str | None = Field(default=None, max_length=2000)
    course_id: str | None = None


class BookmarkResponse(BaseModel):
    id: str
    user_id: str
    course_id: str | None = None
    title: str
    url: str | None = None
    note: str | None = None
    created_at: str | None = None
    updated_at: str | None = None


# ------------------------------------------------------------------
# FLASHCARDS (individual cards)
# ------------------------------------------------------------------
class FlashcardCreate(BaseModel):
    front: str = Field(min_length=1, max_length=4000)
    back: str = Field(min_length=1, max_length=4000)


class FlashcardUpdate(BaseModel):
    front: str | None = Field(default=None, min_length=1, max_length=4000)
    back: str | None = Field(default=None, min_length=1, max_length=4000)


class FlashcardResponse(BaseModel):
    id: str
    user_id: str
    deck_id: str
    front: str
    back: str
    created_at: str | None = None
