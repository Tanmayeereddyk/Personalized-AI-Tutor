"""Human-readable, verifiable source references for grounded output.

Every citation produced here points at a real stored chunk or a saved note, so
a note or tutor answer can cite exactly where a fact came from. Nothing is
fabricated: a citation is only built from a row that actually exists.
"""

from __future__ import annotations

from typing import Any

_KIND_BY_SOURCE = {
    "pdf": "pdf",
    "ppt": "slides",
    "video": "video",
}


def format_timestamp(seconds: float | int | None) -> str:
    """Format seconds as ``mm:ss`` (or ``h:mm:ss`` past an hour)."""
    total = max(0, int(round(float(seconds or 0))))
    hours, remainder = divmod(total, 3600)
    minutes, secs = divmod(remainder, 60)
    if hours:
        return f"{hours}:{minutes:02d}:{secs:02d}"
    return f"{minutes}:{secs:02d}"


def _kind(source_type: str | None) -> str:
    return {
        "pdf": "pdf",
        "ppt": "slides",
        "pptx": "slides",
        "ppt/pptx": "slides",
        "video": "video",
    }.get((source_type or "").lower(), "material")


def chunk_locator(chunk: dict) -> str:
    """A short human label for where a chunk came from."""
    if chunk.get("page_number") is not None:
        return f"Page {chunk['page_number']}"
    if chunk.get("slide_number") is not None:
        return f"Slide {chunk['slide_number']}"
    if chunk.get("start_timestamp_seconds") is not None:
        start = format_timestamp(chunk["start_timestamp_seconds"])
        end = chunk.get("end_timestamp_seconds")
        return f"{start}–{format_timestamp(end)}" if end is not None else start
    return "Extracted content"


def chunk_citation(chunk: dict, material_name: str | None = None) -> dict:
    """A structured citation pointing at one retrieved chunk."""
    return {
        "kind": _kind(chunk.get("source_type")),
        "material_id": chunk.get("material_id"),
        "material_name": material_name or chunk.get("material_name") or "Material",
        "chunk_id": chunk.get("id"),
        "label": chunk_locator(chunk),
        "page": chunk.get("page_number"),
        "slide": chunk.get("slide_number"),
        "start": chunk.get("start_timestamp_seconds"),
        "end": chunk.get("end_timestamp_seconds"),
        "snippet": (chunk.get("content") or "")[:200],
    }


def note_citation(note: dict) -> dict:
    """A structured citation pointing at a saved note."""
    return {
        "kind": "note",
        "note_id": note.get("id"),
        "material_id": None,
        "material_name": note.get("title") or "Saved note",
        "label": "Saved note",
        "snippet": (note.get("content") or "")[:200],
    }


def format_citation(citation: dict) -> str:
    """Render a citation as a short inline label (for inline references)."""
    name = citation.get("material_name") or "Material"
    label = citation.get("label")
    if citation.get("kind") == "note":
        return f"note: {name}"
    return f"{name} · {label}" if label else name
