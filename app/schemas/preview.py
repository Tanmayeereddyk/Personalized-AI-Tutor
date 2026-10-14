"""Schemas for the inline material preview (presentations → PDF/slides)."""

from pydantic import BaseModel, Field


class PreviewSlide(BaseModel):
    """One slide of the text fallback, sourced from the extraction pipeline."""

    number: int
    text: str = ""
    image_url: str | None = None


class PreviewStatusResponse(BaseModel):
    """What the material viewer needs to render (or explain) a preview.

    ``mode`` says how to render it:

    - ``pdf``   — show ``url`` in the existing PDF viewer.
    - ``slides``— render the ``slides`` list (presentation fallback).
    - ``text``  — render ``text`` (document / plain-text fallback).
    - ``none``  — nothing to show; ``message`` explains why.
    """

    status: str  # none | processing | ready | failed | unsupported
    mode: str  # pdf | slides | text | none
    url: str | None = None
    slides: list[PreviewSlide] = Field(default_factory=list)
    text: str | None = None
    message: str | None = None
