"""Ownership-safe persistence for the ``extracted_units`` table.

``extracted_units`` has no ``user_id`` column — ownership is inherited from
its parent, the ``materials`` row it points at. Every function therefore
resolves the owning material through the authenticated user first (via
``owned_service.get_item(..., "materials", ...)``, which hides other users'
rows as 404), then works on the units underneath it. A user can never reach
another user's extraction results by guessing a unit id or material id.
"""

from fastapi import HTTPException
from supabase import Client, PostgrestAPIError

from app.services import owned_service

TABLE = "extracted_units"
BUCKET = "materials"

# The live extracted_units table constrains content_type to
# ('text','table','transcript','image','diagram') and status to
# ('extracted','failed','warning'). The warning "summary" row is therefore a
# text unit flagged via metadata["kind"] == "summary" — the only way to persist
# it without violating the database constraints.
SUMMARY_CONTENT_TYPE = "text"
SUMMARY_KIND = "summary"

# Transcript units are plain text (content_type "text") tagged with their
# provenance so they can be told apart from PDF/slide text and regenerated.
# ``extraction_method`` is the authoritative marker; metadata mirrors it so the
# source of an audio transcript is explicit on the row itself.
TRANSCRIPT_METHOD = "whisper_transcription"
TRANSCRIPT_KIND = "transcript"
AUDIO_TRANSCRIPT_SOURCE = "audio_transcript"


def is_summary_row(row: dict) -> bool:
    """True for the persisted warning/summary row (never counts as content)."""
    if row.get("content_type") == "summary":  # legacy marker from old runs
        return True
    return (row.get("metadata") or {}).get("kind") == SUMMARY_KIND


def _db_error(exc: PostgrestAPIError) -> HTTPException:
    return HTTPException(
        status_code=500,
        detail="Database error. Run database/schema.sql in Supabase first.",
    )


def ensure_material_owned(client: Client, user_id: str, material_id: str) -> dict:
    """Return the material row, or 404 if it is not the user's.

    This is the single gateway used before touching any extracted unit, so
    every unit stays linked to a material the caller actually owns.
    """
    return owned_service.get_item(client, user_id, "materials", material_id)


def _unit_row_or_404(client: Client, user_id: str, unit_id: str) -> dict:
    """Fetch one unit by id and verify its material belongs to the user."""
    try:
        result = (
            client.table(TABLE)
            .select("*")
            .eq("id", unit_id)
            .maybe_single()
            .execute()
        )
    except PostgrestAPIError as exc:
        raise _db_error(exc) from exc

    row = getattr(result, "data", None)
    if row is None:
        raise HTTPException(status_code=404, detail="Not found")

    ensure_material_owned(client, user_id, row["material_id"])
    return row


def list_units(
    client: Client,
    user_id: str,
    material_id: str,
    *,
    content_type: str | None = None,
    page_number: int | None = None,
    slide_number: int | None = None,
    from_timestamp: float | None = None,
    to_timestamp: float | None = None,
) -> list[dict]:
    """Return the user's extracted units for one material, in source order.

    ``unit_order`` records where each unit belongs (page, slide or video
    timestamp), so units are returned ascending, exactly as extracted.
    """
    ensure_material_owned(client, user_id, material_id)

    query = client.table(TABLE).select("*").eq("material_id", material_id)
    if content_type is not None:
        query = query.eq("content_type", content_type)
    if page_number is not None:
        query = query.eq("page_number", page_number)
    if slide_number is not None:
        query = query.eq("slide_number", slide_number)
    if from_timestamp is not None:
        query = query.gte("start_timestamp_seconds", from_timestamp)
    if to_timestamp is not None:
        query = query.lte("start_timestamp_seconds", to_timestamp)

    try:
        result = query.order("unit_order").execute()
    except PostgrestAPIError as exc:
        raise _db_error(exc) from exc

    return list(result.data or [])


def get_unit(client: Client, user_id: str, unit_id: str) -> dict:
    """Return one of the user's units (404 for ids that aren't theirs)."""
    return _unit_row_or_404(client, user_id, unit_id)


def list_transcript_units(client: Client, user_id: str, material_id: str) -> list[dict]:
    """Return a material's audio-transcript segments, in source order.

    Transcript segments are stored as ``content_type == "text"`` rows flagged
    with ``extraction_method == "whisper_transcription"``; this selects exactly
    those, so the audio transcript can be retrieved on its own by the notes,
    retrieval and tutoring pipelines without pulling in frames or PDF text.
    """
    ensure_material_owned(client, user_id, material_id)

    try:
        result = (
            client.table(TABLE)
            .select("*")
            .eq("material_id", material_id)
            .eq("extraction_method", TRANSCRIPT_METHOD)
            .order("unit_order")
            .execute()
        )
    except PostgrestAPIError as exc:
        raise _db_error(exc) from exc

    return list(result.data or [])


def update_unit(
    client: Client, user_id: str, unit_id: str, changes: dict
) -> dict:
    """Update mutable fields of one of the user's units."""
    _unit_row_or_404(client, user_id, unit_id)

    try:
        result = (
            client.table(TABLE).update(changes).eq("id", unit_id).execute()
        )
    except PostgrestAPIError as exc:
        raise _db_error(exc) from exc

    if not result.data:
        raise HTTPException(status_code=404, detail="Not found")
    return result.data[0]


def replace_units(
    client: Client, user_id: str, material_id: str, units: list[dict]
) -> list[dict]:
    """Persist an extraction run without leaving duplicates behind.

    Strategy (safe on retries):
      1. Insert the fresh units first — if extraction produced nothing or the
         insert fails, the previous run's rows are untouched.
      2. Delete the previous run's rows (rows for this material whose ids are
         not among the freshly inserted ones).

    The window between steps 1 and 2 is a single HTTP request in practice,
    so a retry never ends up with two copies of the same page/slide.
    """
    ensure_material_owned(client, user_id, material_id)
    if not units:
        return []

    try:
        inserted = client.table(TABLE).insert(units).execute()
    except PostgrestAPIError as exc:
        raise _db_error(exc) from exc

    inserted_rows = list(inserted.data or [])
    new_ids = [row["id"] for row in inserted_rows if row.get("id")]

    if new_ids:
        try:
            (
                client.table(TABLE)
                .delete()
                .eq("material_id", material_id)
                .not_.in_("id", new_ids)
                .execute()
            )
        except PostgrestAPIError as exc:
            # Old rows may now coexist with the new ones; surface it instead
            # of hiding the partial state.
            raise HTTPException(
                status_code=500,
                detail="Extraction was saved but stale units could not be cleaned up. Retry the extraction.",
            ) from exc

    return inserted_rows


def add_unit(client: Client, user_id: str, material_id: str, unit: dict) -> dict:
    """Insert one extra unit for a material the caller owns.

    Used for late, best-effort additions (for example an indexing warning that
    is only known after the extraction units were already saved). It never
    replaces existing rows, so it cannot disturb an extraction run.
    """
    ensure_material_owned(client, user_id, material_id)
    try:
        result = client.table(TABLE).insert(unit).execute()
    except PostgrestAPIError as exc:
        raise _db_error(exc) from exc
    if not result.data:
        raise HTTPException(status_code=500, detail="Could not save record")
    return result.data[0]


def delete_units_for_material(
    client: Client, user_id: str, material_id: str, *, remove_assets: bool = True
) -> None:
    """Delete a material's extracted rows and (best-effort) their asset files.

    Called when a material is deleted so no orphaned extracted content or
    extracted images are left behind.
    """
    ensure_material_owned(client, user_id, material_id)

    try:
        rows = (
            client.table(TABLE)
            .select("*")
            .eq("material_id", material_id)
            .execute()
        )
    except PostgrestAPIError as exc:
        raise _db_error(exc) from exc

    asset_paths = [
        row["asset_path"]
        for row in (rows.data or [])
        if row.get("asset_path")
    ]

    try:
        (
            client.table(TABLE)
            .delete()
            .eq("material_id", material_id)
            .execute()
        )
    except PostgrestAPIError as exc:
        raise _db_error(exc) from exc

    if remove_assets and asset_paths:
        try:
            client.storage.from_(BUCKET).remove(asset_paths)
        except Exception:  # noqa: BLE001 - the DB rows are gone either way
            pass


def extraction_status(
    client: Client, user_id: str, material_id: str
) -> dict:
    """Processing status, unit count and recorded warnings for a material."""
    material = ensure_material_owned(client, user_id, material_id)
    rows = list_units(client, user_id, material_id)

    warnings: list[str] = []
    unit_count = 0
    for row in rows:
        if is_summary_row(row):
            meta = row.get("metadata") or {}
            warnings.extend(meta.get("warnings") or [])
        else:
            unit_count += 1

    return {
        "material_id": material_id,
        "status": material.get("status", "ready"),
        "unit_count": unit_count,
        "warnings": warnings,
        "updated_at": material.get("updated_at"),
    }


def asset_url(
    client: Client, user_id: str, unit_id: str, expires_in: int = 3600
) -> str:
    """A short-lived signed URL for a unit's extracted image/frame."""
    row = _unit_row_or_404(client, user_id, unit_id)
    path = row.get("asset_path")
    if not path:
        raise HTTPException(status_code=404, detail="This unit has no asset")

    try:
        result = client.storage.from_(BUCKET).create_signed_url(path, expires_in)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(
            status_code=502, detail="Could not create a link to the extracted image"
        ) from exc

    if isinstance(result, dict):
        url = result.get("signedURL") or result.get("signedUrl") or result.get("signed_url")
        if url:
            return url
    raise HTTPException(status_code=502, detail="Could not create a link to the extracted image")