"""Schemas for AI-generated practice quizzes and saved attempts.

A quiz is generated on demand from the course's *selected topics*: the request
carries the topic ids (never materials) and the quiz settings, the service reads
the source content those topics are drawn from, and the language model writes the
questions. The generated quiz *and its answer key* are then persisted server-side
in ``public.quiz_sets`` so a submission can be graded without regenerating it.

The client only ever receives the **public** shape of a question — ``prompt``,
``options`` and provenance — never the correct answer or the explanation. Those
are revealed only by the submit endpoint, after the student's answers have been
recorded and graded on the backend.

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
    """A real, stored source reference for one question.

    The short ``snippet`` of source text is deliberately **not** part of this
    public model: it could hint at the correct answer before submission.
    """

    label: str
    material_id: str | None = None
    material_name: str


class QuizQuestionPublic(BaseModel):
    """One question as shown *before* submission — never the answer key."""

    id: str
    type: str
    prompt: str
    # Present for multiple-choice and true/false; absent for short answer.
    options: list[str] | None = None
    source: QuizQuestionSource | None = None


class QuizGenerateResponse(BaseModel):
    """A complete generated quiz the frontend can take immediately."""

    id: str
    # The persisted ``public.quiz_sets`` row used later to grade a submission.
    set_id: str
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
    questions: list[QuizQuestionPublic]


class QuizSetResponse(BaseModel):
    """A persisted generated quiz, safe to re-fetch before submitting."""

    id: str
    set_id: str
    course_id: str
    title: str
    scope_label: str
    topic_ids: list[str]
    topic_names: list[str]
    difficulty: str
    question_types: list[str]
    timer_minutes: int | None = None
    generated_at: str
    questions: list[QuizQuestionPublic]


class QuizAnswerInput(BaseModel):
    """One submitted answer, keyed by the question id it belongs to."""

    question_id: str = Field(min_length=1)
    answer: str = Field(default="", max_length=4000)


class QuizSubmitRequest(BaseModel):
    """The answers a student submits for a generated quiz."""

    answers: list[QuizAnswerInput] = Field(default_factory=list)
    time_taken_seconds: int | None = Field(default=None, ge=0, le=86_400)
    # A client-generated idempotency key. A double-click or a retried request
    # reuses the same value, so the backend can never store the attempt twice.
    client_token: str | None = Field(default=None, max_length=120)


class QuizResultItem(BaseModel):
    """The graded outcome of one question (revealed only after submission)."""

    id: str
    type: str
    prompt: str
    options: list[str] | None = None
    given: str = ""
    correct: bool = False
    correct_answer: str
    explanation: str = ""
    source: QuizQuestionSource | None = None


class QuizAttemptDetail(BaseModel):
    """A saved attempt with its answers, the answer key and explanations."""

    id: str
    user_id: str
    course_id: str
    quiz_set_id: str | None = None
    title: str
    scope_label: str | None = None
    topic_ids: list[str] = Field(default_factory=list)
    topic_names: list[str] = Field(default_factory=list)
    difficulty: str = "Medium"
    question_types: list[str] = Field(default_factory=list)
    timer_minutes: int | None = None
    score: int = 0
    total: int = 0
    percentage: int = 0
    # 'ai' for a graded generated quiz, 'manual' for a score logged by hand.
    source: str = "ai"
    submitted_at: str | None = None
    created_at: str | None = None
    results: list[QuizResultItem] = Field(default_factory=list)
