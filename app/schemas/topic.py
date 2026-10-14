"""Schemas for the course knowledge map (topics).

These mirror the ``public.topics`` table (see database/schema.sql and
database/migrations/006_topics.sql). ``user_id`` is always set by the server
from the authenticated token and never accepted from the request body, so a
client cannot claim another user's rows.
"""

from pydantic import BaseModel, Field


class TopicResponse(BaseModel):
    """One knowledge-map entry for a course."""

    id: str
    user_id: str
    course_id: str
    name: str
    # A short, source-grounded description of the topic (AI-generated).
    description: str | None = None
    topic_group: str | None = None
    prerequisite: str | None = None
    # How many of the course's materials the topic is actually drawn from.
    resource_count: int = 0
    # RAG provenance: which of the course's materials produced this topic.
    source_material_ids: list[str] = Field(default_factory=list)
    # True when the topic was produced by the language model (not by hand).
    generated: bool = False
    generation_method: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
