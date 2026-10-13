"""Extraction orchestration: status transitions + persistence.

Flow for ``POST /api/materials/{id}/extraction``:

1. The route calls :func:`begin_extraction`, which validates ownership and
   marks the material ``processing`` (the status the frontend polls).
2. A background task calls :func:`run_extraction`, which downloads the bytes,
   runs the right engine, persists the units and sets the final status
   (``ready`` when content was extracted, ``attention`` otherwise).

Errors are never thrown out of the background task: they are recorded as
warnings (via a persisted summary unit) and material status, so a failure is
visible to the user instead of silently killing the request.
"""

from fastapi import HTTPException
from supabase import Client

from app.services import (
    extracted_unit_service,
    extractors,
    owned_service,
    rag_service,
)

# Human-readable progress stage per material, updated live while a background
# extraction runs and cleared the moment it finishes. The status endpoint
# surfaces it so the UI can say "Extracting audio…" / "Transcribing speech…"
# instead of a single opaque spinner. It is process-local and best-effort: if
# it is missing the UI falls back to a generic message.
_STAGES: dict[str, str] = {}


def get_stage(material_id: str) -> str | None:
    """The live stage for a material, or ``None`` when nothing is running."""
    return _STAGES.get(material_id)


def extraction_status(client: Client, user_id: str, material_id: str) -> dict:
    """Ownership-checked status, with the live extraction stage attached."""
    status = extracted_unit_service.extraction_status(client, user_id, material_id)
    status["stage"] = _STAGES.get(material_id)
    return status


def begin_extraction(client: Client, user_id: str, material_id: str) -> dict:
    """Validate ownership and mark the material as processing."""
    extracted_unit_service.ensure_material_owned(client, user_id, material_id)
    owned_service.update_item(
        client, user_id, "materials", material_id, {"status": "processing"}
    )
    _STAGES[material_id] = "extracting"
    return extraction_status(client, user_id, material_id)


def run_extraction(client: Client, user_id: str, material_id: str) -> None:
    """Download, extract and persist units for one material.

    Never raises: any failure is recorded on the material (status +
    persisted warning unit) so callers can check the outcome.
    """
    try:
        material = extracted_unit_service.ensure_material_owned(
            client, user_id, material_id
        )
    except HTTPException:
        _STAGES.pop(material_id, None)
        return  # Material deleted or no longer owned — nothing to process.

    warnings: list[str] = []
    units: list[dict] = []

    try:
        try:
            content = extractors.download_material(client, material)
            result = extractors.run_extractor(
                client,
                material,
                content,
                on_stage=lambda stage: _STAGES.__setitem__(material_id, stage),
            )
            units = result.units
            warnings = result.warnings
        except extractors.UnsupportedFormatError as exc:
            warnings = [str(exc)]
        except HTTPException:
            warnings = ["The source file could not be read from storage."]
        except Exception as exc:  # noqa: BLE001 - recorded, not raised
            warnings = [f"Extraction failed unexpectedly: {exc}"]

        to_save = list(units)
        summary = extractors.summary_unit(material, warnings)
        if summary is not None:
            to_save.append(summary)

        try:
            saved = extracted_unit_service.replace_units(
                client, user_id, material_id, to_save
            )
        except Exception as exc:  # noqa: BLE001 - recorded, never raised
            warnings.append(
                "The extraction could not be saved to the database "
                f"({exc}); try again."
            )
            saved = []

        content_units = [
            row
            for row in saved
            if not extracted_unit_service.is_summary_row(row)
        ]
        final_status = "ready" if content_units else "attention"
        try:
            owned_service.update_item(
                client, user_id, "materials", material_id, {"status": final_status}
            )
        except HTTPException:
            pass  # The units are saved; the status will be corrected on retry.

        # Index the fresh content for the RAG pipeline (notes + tutor), so the
        # "upload → extract → chunk → embed → store" chain runs automatically.
        # Indexing is best-effort: a failure is recorded as a visible warning
        # and never invalidates the extraction that already succeeded.
        if content_units:
            _STAGES[material_id] = "indexing"
            try:
                rag_service.index_material(client, user_id, material_id)
            except Exception as exc:  # noqa: BLE001 - recorded, never raised
                _record_index_warning(
                    client, user_id, material_id, material, saved, exc
                )
    finally:
        # Always drop the live stage so a crashed run cannot leave the UI
        # polling a phase that no longer exists.
        _STAGES.pop(material_id, None)


def _record_index_warning(
    client: Client,
    user_id: str,
    material_id: str,
    material: dict,
    saved: list[dict],
    exc: Exception,
) -> None:
    """Append an indexing failure to the material's persisted warnings.

    Reuses the summary unit when one already exists, so the message shows up in
    the same warnings list the UI already renders.
    """
    message = (
        "Your content was extracted, but it could not be indexed for notes and "
        f"the tutor ({exc}). Try running extraction again."
    )
    try:
        summary = next(
            (row for row in saved if extracted_unit_service.is_summary_row(row)), None
        )
        if summary is not None:
            metadata = dict(summary.get("metadata") or {})
            metadata["warnings"] = list(metadata.get("warnings") or []) + [message]
            extracted_unit_service.update_unit(
                client, user_id, summary["id"], {"metadata": metadata}
            )
            return
        extra = extractors.summary_unit(material, [message])
        if extra is not None:
            extracted_unit_service.add_unit(client, user_id, material_id, extra)
    except Exception:  # noqa: BLE001 - the extraction result still stands
        pass