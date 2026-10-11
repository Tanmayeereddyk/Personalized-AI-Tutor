"""Schemas for course endpoints."""

from pydantic import BaseModel, Field


class CourseCreate(BaseModel):
    """Body for POST /api/courses."""

    name: str = Field(min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)


class CourseUpdate(BaseModel):
    """Body for PUT /api/courses/{course_id} — all fields optional."""

    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = Field(default=None, max_length=2000)


class CourseResponse(BaseModel):
    """A row from the courses table."""

    id: str
    user_id: str
    name: str
    description: str | None = None
    created_at: str | None = None
    updated_at: str | None = None
