"""Material extraction endpoints.

Everything under here is auth-protected and ownership-checked through the
parent material (see app/services/extracted_unit_service.py): a user can only
start extraction, read status/units, and fetch asset links for their own
materials. Trying someone else's material id or unit id yields 404 — the same
answer as a non-existent id, so ids cannot be probed.
"""

from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query
from supabase import Client

from app.api.dependencies import get_current_user, get_service_supabase
from app.schemas.auth import AuthUser
from app.schemas.extracted_unit import (
    CONTENT_TYPES,
    ExtractedUnitResponse,
    ExtractedUnitUpdate,
    ExtractionStatusResponse,
)
from app.services import extracted_unit_service, extraction_service

router = APIRouter(tags=["extraction"])


@router.post(
    "/api/materials/{material_id}/extraction",
    response_model=ExtractionStatusResponse,
    status_code=202,
)
def start_extraction(
    material_id: str,
    background_tasks: BackgroundTasks,
    user: AuthUser = Depends(get_current_user),
    db: Client = Depends(get_service_supabase),
) -> ExtractionStatusResponse:
    """Start (or restart) extraction for one of the user's materials."""
    status = extraction_service.begin_extraction(db, user.id, material_id)
    background_tasks.add_task(
        extraction_service.run_extraction, db, user.id, material_id
    )
    return ExtractionStatusResponse.model_validate(status)


@router.post(
    "/api/materials/{material_id}/extraction/retry",
    response_model=ExtractionStatusResponse,
    status_code=202,
)
def retry_extraction(
    material_id: str,
    background_tasks: BackgroundTasks,
    user: AuthUser = Depends(get_current_user),
    db: Client = Depends(get_service_supabase),
) -> ExtractionStatusResponse:
    """Re-run extraction (idempotent — a retry never duplicates rows)."""
    status = extraction_service.begin_extraction(db, user.id, material_id)
    background_tasks.add_task(
        extraction_service.run_extraction, db, user.id, material_id
    )
    return ExtractionStatusResponse.model_validate(status)


@router.get(
    "/api/materials/{material_id}/extraction-status",
    response_model=ExtractionStatusResponse,
)
def get_extraction_status(
    material_id: str,
    user: AuthUser = Depends(get_current_user),
    db: Client = Depends(get_service_supabase),
) -> ExtractionStatusResponse:
    """Current processing status, unit count and persisted warnings."""
    return ExtractionStatusResponse.model_validate(
        extraction_service.extraction_status(db, user.id, material_id)
    )


@router.get(
    "/api/materials/{material_id}/extracted-units",
    response_model=list[ExtractedUnitResponse],
)
def list_extracted_units(
    material_id: str,
    user: AuthUser = Depends(get_current_user),
    db: Client = Depends(get_service_supabase),
    content_type: Literal[*CONTENT_TYPES] | None = Query(default=None),
    page_number: int | None = Query(default=None, ge=1),
    slide_number: int | None = Query(default=None, ge=1),
    from_timestamp: float | None = Query(default=None, ge=0),
    to_timestamp: float | None = Query(default=None, ge=0),
) -> list[ExtractedUnitResponse]:
    """List the user's extracted units, in source order, with filters."""
    rows = extracted_unit_service.list_units(
        db,
        user.id,
        material_id,
        content_type=content_type,
        page_number=page_number,
        slide_number=slide_number,
        from_timestamp=from_timestamp,
        to_timestamp=to_timestamp,
    )
    return [ExtractedUnitResponse.model_validate(row) for row in rows]


@router.get(
    "/api/materials/{material_id}/transcript",
    response_model=list[ExtractedUnitResponse],
)
def get_material_transcript(
    material_id: str,
    user: AuthUser = Depends(get_current_user),
    db: Client = Depends(get_service_supabase),
) -> list[ExtractedUnitResponse]:
    """The audio transcript (Whisper segments) for one of the user's videos.

    Reuses the ``extracted_units`` rows produced by video extraction, so the
    notes/retrieval pipeline and the player UI can load just the spoken
    transcript with its timestamps, independently of frames and slide text.
    """
    rows = extracted_unit_service.list_transcript_units(db, user.id, material_id)
    return [ExtractedUnitResponse.model_validate(row) for row in rows]


@router.get(
    "/api/extracted-units/{unit_id}",
    response_model=ExtractedUnitResponse,
)
def get_extracted_unit(
    unit_id: str,
    user: AuthUser = Depends(get_current_user),
    db: Client = Depends(get_service_supabase),
) -> ExtractedUnitResponse:
    """Fetch one of the user's extracted units (404 otherwise)."""
    return ExtractedUnitResponse.model_validate(
        extracted_unit_service.get_unit(db, user.id, unit_id)
    )


@router.put(
    "/api/extracted-units/{unit_id}",
    response_model=ExtractedUnitResponse,
)
def update_extracted_unit(
    unit_id: str,
    payload: ExtractedUnitUpdate,
    user: AuthUser = Depends(get_current_user),
    db: Client = Depends(get_service_supabase),
) -> ExtractedUnitResponse:
    """Update status/content/metadata of one of the user's units."""
    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(status_code=400, detail="No fields to update")
    return ExtractedUnitResponse.model_validate(
        extracted_unit_service.update_unit(db, user.id, unit_id, changes)
    )


@router.get("/api/extracted-units/{unit_id}/asset-url")
def get_extracted_unit_asset_url(
    unit_id: str,
    user: AuthUser = Depends(get_current_user),
    db: Client = Depends(get_service_supabase),
) -> dict[str, str]:
    """A short-lived signed URL for a unit's extracted image/frame."""
    return {"url": extracted_unit_service.asset_url(db, user.id, unit_id)}