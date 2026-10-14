"""Schemas for AI-generated practice quizzes.

A quiz is generated on demand from the course's *selected topics*: the request
carries the topic ids (never materials) and the quiz settings, the service reads
the source content those topics are drawn from, and the language model writes
the questions. Nothing is persisted by the generation endpoint, so these models
describe a request and its generated result only.

``user_id`` is always set by the server from the authenticated token and never
accepted from the request body, so a client cannot claim another user's rows.
"""

from pydantic import BaseModel, Field


class QuizGenerateRequest(BaseModel):
    """The settings chosen on the quiz-configuration screen."""

    # The topics the student selected. Topics are the only selectable unit; the
    # service resolves each topic's source materials internally.
    topic_ids: list[str] = Field(min_length=1)
    question_count: int = Field(default=5, ge=1, le=30)
    difficulty: str = Field(default="Medium", max_length=20)
    question_types: list[str] = Field(
        default_factory=lambda: ["multiple-choice", "true-false", "short-answer"]
    )
    # null means no time limit (the default).
    timer_minutes: int | None = Field(default=None, ge=1, le=600)


class QuizQuestionSource(BaseModel):
    """A real, stored source reference for one generated question."""

    label: str
    material_id: str | None = None
    material_name: str
    snippet: str


class QuizQuestion(BaseModel):
    """One generated question, grounded in the selected topics' content."""

    id: str
    type: str
    prompt: str
    # Present for multiple-choice and true/false; absent for short answer.
    options: list[str] | None = None
    correct_answer: str
    # Extra accepted spellings for short answer (loose matching).
    accepted_answers: list[str] | None = None
    explanation: str
    source: QuizQuestionSource | None = None


class QuizGenerateResponse(BaseModel):
    """A complete generated quiz the frontend can take immediately."""

    id: str
    course_id: str
    title: str
    # A short display label for the selected scope (the topic names).
    scope_label: str
    topic_ids: list[str]
    topic_names: list[str]
    difficulty: str
    question_types: list[str]
    timer_minutes: int | None = None
    generated_at: str
    questions: list[QuizQuestion]
