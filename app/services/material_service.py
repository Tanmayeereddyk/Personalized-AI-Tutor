"""Course material uploads.

Files are stored in the private Supabase Storage bucket ``materials``
under ``<user_id>/<course_id>/<material_id>/<filename>``. The metadata
row in the ``materials`` table is also owned by the user, and every
query filters by the authenticated user id, so files and metadata are
only reachable by their owner.

If the storage bucket is not configured the upload fails with a clear
error instead of pretending the file was saved.
"""

import uuid
from pathlib import Path

from fastapi import HTTPException
from supabase import Client, PostgrestAPIError

from app.schemas.material import MaterialResponse, MaterialUpdate
from app.services import owned_service

BUCKET = "materials"


def _db_error(exc: PostgrestAPIError) -> HTTPException:
    return HTTPException(
        status_code=500,
        detail="Database error. Run database/schema.sql in Supabase first.",
    )


def detect_type(filename: str) -> str:
    """Map a file extension to the small set the UI understands."""
    ext = Path(filename).suffix.lower().lstrip(".")
    if ext == "pdf":
        return "pdf"
    if ext in {"ppt", "pptx"}:
        return "ppt"
    if ext in {"mp4", "mov", "webm", "mkv"}:
        return "video"
    return "doc"


def guess_kind(mime_type: str | None, filename: str) -> str:
    if mime_type and mime_type.startswith("video/"):
        return "Lecture video"
    ext = Path(filename).suffix.lower()
    if ext in {".ppt", ".pptx"}:
        return "Slides"
    if ext == ".pdf":
        return "Document"
    return "Upload"


def upload_material(
    client: Client,
    user_id: str,
    course_id: str,
    filename: str,
    content: bytes,
    content_type: str | None,
) -> MaterialResponse:
    """Store the file and its metadata for the current user."""
    owned_service.ensure_course_owned(client, user_id, course_id)

    material_id = str(uuid.uuid4())
    safe_name = Path(filename).name or "file"
    storage_path = f"{user_id}/{course_id}/{material_id}/{safe_name}"

    # 1. Upload the bytes to private storage.
    try:
        client.storage.from_(BUCKET).upload(
            storage_path,
            content,
            {"content-type": content_type or "application/octet-stream", "upsert": "false"},
        )
    except Exception as exc:  # noqa: BLE001 - storage errors are external
        raise HTTPException(
            status_code=502,
            detail=(
                "Could not store the uploaded file. Make sure the private "
                "'materials' storage bucket exists (run database/schema.sql)."
            ),
        ) from exc

    # 2. Persist metadata owned by the user. If this fails, remove the
    #    orphaned object so we never leave a half-finished upload behind.
    try:
        result = (
            client.table("materials")
            .insert(
                {
                    "id": material_id,
                    "user_id": user_id,
                    "course_id": course_id,
                    "name": safe_name,
                    "type": detect_type(safe_name),
                    "kind": guess_kind(content_type, safe_name),
                    "size_bytes": len(content),
                    "mime_type": content_type,
                    "storage_path": storage_path,
                    "status": "ready",
                }
            )
            .execute()
        )
    except PostgrestAPIError as exc:
        try:
            client.storage.from_(BUCKET).remove([storage_path])
        except Exception:  # noqa: BLE001
            pass
        raise _db_error(exc) from exc

    return MaterialResponse.model_validate(result.data[0])


def list_materials(client: Client, user_id: str, course_id: str) -> list[MaterialResponse]:
    """List the current user's materials for one of their courses."""
    owned_service.ensure_course_owned(client, user_id, course_id)
    rows = owned_service.list_items(client, user_id, "materials", course_id=course_id)
    return [MaterialResponse.model_validate(row) for row in rows]


def get_material(client: Client, user_id: str, material_id: str) -> MaterialResponse:
    row = owned_service.get_item(client, user_id, "materials", material_id)
    return MaterialResponse.model_validate(row)


def update_material(
    client: Client, user_id: str, material_id: str, payload: MaterialUpdate
) -> MaterialResponse:
    changes = payload.model_dump(exclude_unset=True)
    row = owned_service.update_item(client, user_id, "materials", material_id, changes)
    return MaterialResponse.model_validate(row)


def material_url(client: Client, user_id: str, material_id: str, expires_in: int = 3600) -> str:
    """Return a short-lived signed URL for one of the user's files."""
    row = owned_service.get_item(client, user_id, "materials", material_id)
    path = row.get("storage_path")
    if not path:
        raise HTTPException(status_code=404, detail="File not available")

    try:
        result = client.storage.from_(BUCKET).create_signed_url(path, expires_in)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail="Could not create a file link") from exc

    if isinstance(result, dict):
        url = result.get("signedURL") or result.get("signedUrl") or result.get("signed_url")
        if url:
            return url
    raise HTTPException(status_code=502, detail="Could not create a file link")


def delete_material(client: Client, user_id: str, material_id: str) -> None:
    """Delete the row and its stored object (owner only)."""
    row = owned_service.get_item(client, user_id, "materials", material_id)
    path = row.get("storage_path")

    owned_service.delete_item(client, user_id, "materials", material_id)

    if path:
        try:
            client.storage.from_(BUCKET).remove([path])
        except Exception:  # noqa: BLE001 - the row is gone either way
            pass
