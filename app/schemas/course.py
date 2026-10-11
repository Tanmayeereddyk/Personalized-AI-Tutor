"""Schemas for course endpoints."""

from pydantic import BaseModel, Field

# The UI keeps a small palette / icon set per course. Values are validated
# here so a client cannot store arbitrary markup in these columns.
COURSE_COLORS = ("mint", "sky", "amber", "rose", "violet", "lime")
COURSE_ICONS = ("sigma", "boxes", "database", "atom", "code", "book")


class CourseCreate(BaseModel):
    """Body for POST /api/courses."""

    name: str = Field(min_length=1, max_length=200)
    code: str | None = Field(default=None, max_length=32)
    description: str | None = Field(default=None, max_length=2000)
    color: str = Field(default="mint")
    icon: str = Field(default="book")


class CourseUpdate(BaseModel):
    """Body for PUT /api/courses/{course_id} — all fields optional."""

    name: str | None = Field(default=None, min_length=1, max_length=200)
    code: str | None = Field(default=None, max_length=32)
    description: str | None = Field(default=None, max_length=2000)
    color: str | None = Field(default=None)
    icon: str | None = Field(default=None)


class CourseResponse(BaseModel):
    """A row from the courses table."""

    id: str
    user_id: str
    name: str
    code: str = "COURSE"
    description: str | None = None
    color: str = "mint"
    icon: str = "book"
    created_at: str | None = None
    updated_at: str | None = None
