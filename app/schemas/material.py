"""Schemas for uploaded course materials."""

from pydantic import BaseModel, Field


class MaterialUpdate(BaseModel):
    """Only the display name / processing status can be changed."""

    name: str | None = Field(default=None, min_length=1, max_length=300)
    kind: str | None = Field(default=None, max_length=100)
    status: str | None = Field(default=None, max_length=32)


class MaterialResponse(BaseModel):
    id: str
    user_id: str
    course_id: str
    name: str
    type: str = "doc"
    kind: str = "Upload"
    size_bytes: int | None = None
    mime_type: str | None = None
    storage_path: str | None = None
    status: str = "ready"
    created_at: str | None = None
    updated_at: str | None = None
