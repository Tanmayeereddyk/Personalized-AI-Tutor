"""Request and response shapes for source-grounded AI flashcard decks."""

from pydantic import BaseModel, Field


class FlashcardGenerateRequest(BaseModel):
    deck_name: str = Field(min_length=1, max_length=300)
    topic_ids: list[str] = Field(min_length=1)
    cards_per_topic: int = Field(default=5, ge=1, le=30)
    difficulty: str = Field(default="Medium", pattern="^(Easy|Medium|Hard)$")


class FlashcardTopicResult(BaseModel):
    topic_id: str
    topic: str
    requested: int
    generated: int
    message: str | None = None


class FlashcardGenerateResponse(BaseModel):
    deck: dict
    cards: list[dict]
    topics: list[FlashcardTopicResult]
    message: str | None = None
