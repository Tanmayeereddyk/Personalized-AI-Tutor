"""Inline preview for uploaded Office materials (``.ppt``/``.pptx``/``.doc``/``.docx``) and plain text.

A browser cannot render an Office file on its own, which is why the
material viewer used to fall back to "Download the file or open it in
your usual app instead". This service removes that dead end **without
sending the file anywhere**: the file is converted to PDF on the
server, with a local LibreOffice install in headless mode, and the
existing PDF viewer renders the result. The original is never modified
and stays downloadable.

Plain text (``.txt``) needs no conversion — the extracted text is
shown directly. Documents (``.docx``) and presentations (``.pptx``)
also fall back to their extracted text when LibreOffice is absent.

Design notes:
- **Cached, never repeated.** The converted PDF is stored once, under
  the material's own folder (``<user>/<course>/<material>/preview/preview.pdf``),
  the same private bucket and ownership layout as the file itself. Re-opening
  the material reuses it; an unchanged file is never converted twice. The
  object's existence is the source of truth, so the cache survives restarts.
- **Local only.** No external conversion service is ever called. Conversion
  runs as a child process on this machine.
- **Graceful.** If LibreOffice is not installed (some slim deployment
  images) the viewer degrades to the text the *existing* extraction
  pipeline already produced (slide text for decks, document text for
  Word files), and says so. It never pretends the preview succeeded.
- **Independent of extraction.** Producing a preview never changes the
  material's processing status, its extracted units, its RAG chunks or
  its notes. A preview is a viewer convenience, not proof that
  extraction worked.
"""

from __future__ import annotations

import logging
import threading

from fastapi import HTTPException
from supabase import Client

from app.services import extracted_unit_service, extractors, owned_service
from app.services.office_conversion import (
    OfficeConversionError,
    convert_to_pdf,
    find_soffice,
)

logger = logging.getLogger("studyai.preview")

BUCKET = "materials"
PREVIEW_FILENAME = "preview.pdf"
MAX_PREVIEW_SOURCE_BYTES = 100 * 1024 * 1024

_NO_LIBREOFFICE = (
    "Inline rendering needs LibreOffice on the server, which is not "
    "installed. Showing the extracted text instead — download the "
    "original file to see the full layout."
)

_GENERIC_FAILURE = (
    "The file could not be converted for an inline preview. You can "
    "still download the original file."
)

# Process-local view of in-flight/failed conversions. The converted object in
# storage is the durable "ready" marker; this only carries the short-lived
# "processing" and "failed" states between requests.
_PREVIEW_STAGES: dict[str, dict] = {}
_PREVIEW_LOCKS: dict[str, threading.Lock] = {}
_PREVIEW_LOCKS_GUARD = threading.Lock()

# A local conversion failure surfaces as a preview error.
PreviewError = OfficeConversionError


def _lock(material_id: str) -> threading.Lock:
    with _PREVIEW_LOCKS_GUARD:
        return _PREVIEW_LOCKS.setdefault(material_id, threading.Lock())


# ----------------------------------------------------------------------
# LibreOffice discovery (shared with extraction — see office_conversion)
# ----------------------------------------------------------------------

def conversion_available() -> bool:
    """True when this server can convert a document to PDF locally."""
    return find_soffice() is not None


# ----------------------------------------------------------------------
# Storage helpers
# ----------------------------------------------------------------------

def preview_path(material: dict) -> str:
    """Where the converted preview PDF for a material lives in storage."""
    return (
        f"{material['user_id']}/{material['course_id']}/"
        f"{material['id']}/preview/{PREVIEW_FILENAME}"
    )


def _preview_object_exists(client: Client, path: str) -> bool:
    """True when the converted PDF is already stored (the durable cache marker)."""
    folder = path.rsplit("/", 1)[0]
    try:
        entries = client.storage.from_(BUCKET).list(folder)
    except Exception:  # noqa: BLE001 - storage is external; treat as "not there"
        return False
    for entry in entries or []:
        name = entry.get("name") if isinstance(entry, dict) else getattr(entry, "name", None)
        if name == PREVIEW_FILENAME:
            return True
    return False


def _signed_url(client: Client, path: str, expires_in: int = 3600) -> str:
    try:
        result = client.storage.from_(BUCKET).create_signed_url(path, expires_in)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=502, detail="Could not create a link to the slide preview"
        ) from exc
    if isinstance(result, dict):
        url = result.get("signedURL") or result.get("signedUrl") or result.get("signed_url")
        if url:
            return url
    raise HTTPException(status_code=502, detail="Could not create a link to the slide preview")


def _mark(client: Client, user_id: str, material_id: str, **fields: object) -> None:
    """Best-effort persistence of preview state (never breaks the preview).

    The preview itself is cached in storage; these columns only make the
    in-flight/error state visible across requests and workers. If the optional
    migration has not been run, the storage cache still does all the work.
    """
    try:
        owned_service.update_item(client, user_id, "materials", material_id, dict(fields))
    except Exception:  # noqa: BLE001 - optional bookkeeping
        pass


# ----------------------------------------------------------------------
# Slide-by-slide fallback (existing extraction pipeline)
# ----------------------------------------------------------------------

def _slides(client: Client, user_id: str, material_id: str) -> list[dict]:
    """Slide text (and any slide image) from the material's extracted units.

    This is the graceful fallback when PDF conversion is unavailable or fails:
    it reuses the ``pptx_text`` units the extraction pipeline already produced,
    ordered by slide number, and exposes any slide image a future engine stores.
    """
    units = extracted_unit_service.list_units(client, user_id, material_id)
    slides: list[dict] = []
    for row in units:
        if extracted_unit_service.is_summary_row(row):
            continue
        number = row.get("slide_number")
        if number is None:
            continue
        image_url: str | None = None
        asset = row.get("asset_path")
        if asset:
            try:
                image_url = _signed_url(client, asset)
            except HTTPException:
                image_url = None
        slides.append(
            {
                "number": int(number),
                "text": (row.get("content") or "").strip(),
                "image_url": image_url,
            }
        )
    slides.sort(key=lambda slide: slide["number"])
    return slides


def _is_presentation(material: dict) -> bool:
    return (material.get("type") or "").lower() == "ppt"


def _is_document(material: dict) -> bool:
    return (material.get("type") or "").lower() == "doc"


def _is_plain_text(material: dict) -> bool:
    return (material.get("name") or "").lower().endswith(".txt")


def _pdf_state(
    client: Client,
    path: str,
    *,
    slides: list[dict] | None = None,
    text: str | None = None,
) -> dict:
    return {
        "status": "ready",
        "mode": "pdf",
        "url": _signed_url(client, path),
        "slides": slides or [],
        "text": text,
        "message": None,
    }


def _text_state(status: str, text: str, message: str | None) -> dict:
    return {
        "status": status,
        "mode": "text" if text else "none",
        "url": None,
        "slides": [],
        "text": text,
        "message": message,
    }


def _document_text(client: Client, user_id: str, material_id: str) -> str:
    """The material's extracted text, for the document text fallback."""
    units = extracted_unit_service.list_units(client, user_id, material_id)
    parts: list[str] = []
    for row in units:
        if extracted_unit_service.is_summary_row(row):
            continue
        content = (row.get("content") or "").strip()
        if content:
            parts.append(content)
    return "\n\n".join(parts)


def _fallback_state(
    client: Client, user_id: str, material_id: str, status: str, message: str
) -> dict:
    """The no-conversion fallback: slides for a deck, text for a document."""
    material = extracted_unit_service.ensure_material_owned(client, user_id, material_id)
    if _is_presentation(material):
        slides = _slides(client, user_id, material_id)
        return {
            "status": status,
            "mode": "slides" if slides else "none",
            "url": None,
            "slides": slides,
            "text": None,
            "message": message,
        }
    text = _document_text(client, user_id, material_id)
    return _text_state(status, text, message)


# ----------------------------------------------------------------------
# State
# ----------------------------------------------------------------------

def preview_state(client: Client, user_id: str, material_id: str) -> dict:
    """The current preview for a material, without starting any work."""
    material = extracted_unit_service.ensure_material_owned(client, user_id, material_id)

    material_type = (material.get("type") or "").lower()
    if material_type not in {"ppt", "doc"}:
        return {
            "status": "unsupported",
            "mode": "none",
            "url": None,
            "slides": [],
            "text": None,
            "message": "Inline preview is only available for presentations and documents.",
        }

    # Plain text renders directly — no conversion is ever needed.
    if _is_plain_text(material):
        return _text_state(
            "ready", _document_text(client, user_id, material_id), None
        )

    path = material.get("preview_path") or preview_path(material)
    if _preview_object_exists(client, path):
        if _is_presentation(material):
            return _pdf_state(client, path, slides=_slides(client, user_id, material_id))
        return _pdf_state(client, path, text=_document_text(client, user_id, material_id))

    local = _PREVIEW_STAGES.get(material_id) or {}
    status = local.get("status") or material.get("preview_status")

    if status == "processing":
        return {
            "status": "processing",
            "mode": "none",
            "url": None,
            "slides": [],
            "text": None,
            "message": "Preparing the preview…",
        }

    if status == "failed":
        message = local.get("message") or material.get("preview_error") or _GENERIC_FAILURE
        return _fallback_state(client, user_id, material_id, "failed", message)

    if not conversion_available():
        return _fallback_state(
            client, user_id, material_id, "unsupported", _NO_LIBREOFFICE
        )

    return {
        "status": "none",
        "mode": "none",
        "url": None,
        "slides": [],
        "text": None,
        "message": None,
    }


def begin_preview(client: Client, user_id: str, material_id: str) -> tuple[dict, bool]:
    """Start a preview conversion if one is needed.

    Returns ``(state, started)``. ``started`` is True only when the caller should
    queue the background conversion — an already-ready (or unsupported) preview
    returns immediately and is never reconverted.
    """
    material = extracted_unit_service.ensure_material_owned(client, user_id, material_id)
    material_type = (material.get("type") or "").lower()
    if material_type not in {"ppt", "doc"}:
        raise HTTPException(
            status_code=400,
            detail="Inline preview is only available for presentations and documents.",
        )

    state = preview_state(client, user_id, material_id)
    if state["status"] in {"ready", "unsupported", "failed", "processing"}:
        return state, False

    if not conversion_available():
        _PREVIEW_STAGES[material_id] = {"status": "unsupported"}
        _mark(client, user_id, material_id, preview_status="unsupported", preview_error=_NO_LIBREOFFICE)
        return preview_state(client, user_id, material_id), False

    _PREVIEW_STAGES[material_id] = {"status": "processing"}
    _mark(client, user_id, material_id, preview_status="processing", preview_error=None)
    return preview_state(client, user_id, material_id), True


# ----------------------------------------------------------------------
# Conversion
# ----------------------------------------------------------------------

def run_preview_conversion(client: Client, user_id: str, material_id: str) -> None:
    """Convert a material's presentation to PDF and cache it in storage.

    Never raises: any failure is recorded as a visible "failed" preview state so
    the UI can explain it and keep the download option working.
    """
    try:
        material = extracted_unit_service.ensure_material_owned(
            client, user_id, material_id
        )
    except HTTPException:
        _PREVIEW_STAGES.pop(material_id, None)
        return

    with _lock(material_id):
        try:
            soffice = find_soffice()
            if not soffice:
                # LibreOffice vanished between the request and the run:
                # preview_state re-derives the "unsupported" fallback.
                _PREVIEW_STAGES.pop(material_id, None)
                _mark(
                    client,
                    user_id,
                    material_id,
                    preview_status="unsupported",
                    preview_error=_NO_LIBREOFFICE,
                )
                return

            try:
                if (material.get("size_bytes") or 0) > MAX_PREVIEW_SOURCE_BYTES:
                    raise PreviewError(
                        "This file is too large for server-side inline conversion "
                        "(maximum 100 MB). Download the original to view it."
                    )
                content = extractors.download_material(client, material)
                if len(content) > MAX_PREVIEW_SOURCE_BYTES:
                    raise PreviewError(
                        "This file is too large for server-side inline conversion "
                        "(maximum 100 MB). Download the original to view it."
                    )
                pdf = convert_to_pdf(soffice, content, material.get("name") or "slides.pptx")
                path = preview_path(material)
                client.storage.from_(BUCKET).upload(
                    path,
                    pdf,
                    {"content-type": "application/pdf", "upsert": "true"},
                )
            except Exception as exc:  # noqa: BLE001 - cache the failure for the UI
                message = (
                    str(exc) if isinstance(exc, PreviewError) else _GENERIC_FAILURE
                )
                logger.warning("preview: conversion failed for %s: %s", material_id, exc)
                _PREVIEW_STAGES[material_id] = {"status": "failed", "message": message}
                _mark(
                    client,
                    user_id,
                    material_id,
                    preview_status="failed",
                    preview_error=message,
                )
                return

            _PREVIEW_STAGES.pop(material_id, None)
            _mark(
                client,
                user_id,
                material_id,
                preview_path=path,
                preview_status="ready",
                preview_error=None,
            )
        finally:
            # A successful run cleared the stage above; a crash still must not
            # leave the UI polling a phase that no longer exists.
            if _PREVIEW_STAGES.get(material_id, {}).get("status") == "processing":
                _PREVIEW_STAGES.pop(material_id, None)
