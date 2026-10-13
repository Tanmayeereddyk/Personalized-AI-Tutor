"""Schemas for the RAG pipeline: indexing, chunks, notes generation, tutoring.

Every citation returned to the client points at a chunk or note that was really
retrieved, so the UI can show exactly where an answer came from.
"""

from pydantic import BaseModel, Field


class IndexResult(BaseModel):
    """Outcome of (re)building one material's chunk index."""

    material_id: str
    chunk_count: int
    embedding_model: str


class IndexStatus(BaseModel):
    """Whether a material has been indexed for retrieval, and why not."""

    material_id: str
    chunk_count: int
    indexed: bool
    embedding_model: str | None = None
    # Units that really carry text (i.e. could become chunks).
    unit_count: int = 0
    # Set when indexing cannot run yet (for example the RAG migration is absent).
    message: str | None = None


class ChunkResponse(BaseModel):
    """One indexed chunk with its source location (embedding omitted)."""

    id: str
    material_id: str
    course_id: str
    source_type: str
    chunk_order: int
    content: str
    page_number: int | None = None
    slide_number: int | None = None
    start_timestamp_seconds: float | None = None
    end_timestamp_seconds: float | None = None
    extraction_method: str | None = None


class CitationModel(BaseModel):
    """A single source reference (page / slide / timestamp / saved note)."""

    kind: str
    material_id: str | None = None
    material_name: str | None = None
    label: str | None = None
    page: int | None = None
    slide: int | None = None
    start: float | None = None
    end: float | None = None
    note_id: str | None = None
    snippet: str | None = None
    material_deleted: bool | None = None


class NotesGenerateRequest(BaseModel):
    """Which scope to generate notes for."""

    material_id: str | None = None
    # When set, regenerate this existing (generated) note instead of creating one.
    note_id: str | None = None


class TutorTurn(BaseModel):
    """One prior turn of the conversation, replayed to the tutor model."""

    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(min_length=1, max_length=8000)


class TutorAskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    material_id: str | None = None
    # Prior turns (oldest first) so follow-up questions keep their context.
    history: list[TutorTurn] = Field(default_factory=list)


class TutorAnswerResponse(BaseModel):
    answer: str
    citations: list[CitationModel] = Field(default_factory=list)
    # True when the answer is grounded in (and cites) the user's own content.
    grounded: bool
    used_materials: list[str] = Field(default_factory=list)
