"""Course material endpoints (upload, list, open, delete).

All routes require authentication. Files are private to their owner and
the metadata queries always filter by the authenticated user id.

Uploading a file also *starts processing it*: extraction (and, when it
succeeds, chunking + embedding for the RAG pipeline) is queued as a
background task, so the student never has to press an "Extract" button.
Extraction itself is internal processing — the raw extracted units, frames,
chunks and embeddings are never part of the student's ordinary UI.
"""

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    HTTPException,
    Response,
    UploadFile,
)
from supabase import Client

from app.api.dependencies import get_current_user, get_service_supabase
from app.schemas.auth import AuthUser
from app.schemas.material import MaterialResponse, MaterialUpdate
from app.services import extraction_service, material_service

router = APIRouter(tags=["materials"])


@router.post(
    "/api/courses/{course_id}/materials",
    response_model=list[MaterialResponse],
    status_code=201,
)
async def upload_materials(
    course_id: str,
    background_tasks: BackgroundTasks,
    files: list[UploadFile] = File(...),
    user: AuthUser = Depends(get_current_user),
    db: Client = Depends(get_service_supabase),
) -> list[MaterialResponse]:
    """Upload one or more files to one of the user's courses.

    The upload response reports each file as ``processing``: extraction (and,
    on success, chunking + embedding) is queued right here, so processing is
    part of the upload pipeline rather than a separate user action. The
    material flips to ``ready`` (or ``attention`` with warnings) once the
    background work finishes; the frontend only polls the status endpoint.
    """
    if not files:
        raise HTTPException(status_code=422, detail="No files were uploaded")

    saved: list[MaterialResponse] = []
    for upload in files:
        content = await upload.read()
        if not content:
            continue
        saved.append(
            material_service.upload_material(
                db,
                user.id,
                course_id,
                upload.filename or "file",
                content,
                upload.content_type,
            )
        )

    if not saved:
        raise HTTPException(status_code=422, detail="The uploaded files were empty")

    for material in saved:
        try:
            extraction_service.begin_extraction(db, user.id, material.id)
        except HTTPException:
            # A file that could not be queued stays as uploaded but is not
            # claimed to be processing; the status endpoint drives the UI.
            continue
        background_tasks.add_task(
            extraction_service.run_extraction, db, user.id, material.id
        )
        material.status = "processing"

    return saved


@router.get(
    "/api/courses/{course_id}/materials",
    response_model=list[MaterialResponse],
)
def list_materials(
    course_id: str,
    user: AuthUser = Depends(get_current_user),
    db: Client = Depends(get_service_supabase),
) -> list[MaterialResponse]:
    """List the current user's materials for one of their courses."""
    return material_service.list_materials(db, user.id, course_id)


@router.get("/api/materials/{material_id}", response_model=MaterialResponse)
def get_material(
    material_id: str,
    user: AuthUser = Depends(get_current_user),
    db: Client = Depends(get_service_supabase),
) -> MaterialResponse:
    return material_service.get_material(db, user.id, material_id)


@router.get("/api/materials/{material_id}/url")
def get_material_url(
    material_id: str,
    user: AuthUser = Depends(get_current_user),
    db: Client = Depends(get_service_supabase),
) -> dict[str, str]:
    """A short-lived signed URL, only for the owner."""
    return {"url": material_service.material_url(db, user.id, material_id)}


@router.put("/api/materials/{material_id}", response_model=MaterialResponse)
def update_material(
    material_id: str,
    payload: MaterialUpdate,
    user: AuthUser = Depends(get_current_user),
    db: Client = Depends(get_service_supabase),
) -> MaterialResponse:
    return material_service.update_material(db, user.id, material_id, payload)


@router.delete("/api/materials/{material_id}", status_code=204)
def delete_material(
    material_id: str,
    user: AuthUser = Depends(get_current_user),
    db: Client = Depends(get_service_supabase),
) -> Response:
    material_service.delete_material(db, user.id, material_id)
    return Response(status_code=204)
