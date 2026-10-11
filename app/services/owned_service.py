"""Generic ownership-safe CRUD for per-user learning data.

Every function takes the authenticated user's id (from the validated
token, never from the request body) and adds ``.eq("user_id", user_id)``
to the query. A record that belongs to somebody else simply does not
match, so it is reported as 404 — the same as a record that does not
exist. This is the single place the ownership rule is implemented, so
notes, quizzes, decks, assessments, events and bookmarks all behave the
same way.
"""

from fastapi import HTTPException
from supabase import Client, PostgrestAPIError


def _db_error(exc: PostgrestAPIError) -> HTTPException:
    return HTTPException(
        status_code=500,
        detail="Database error. Run database/schema.sql in Supabase first.",
    )


def ensure_course_owned(client: Client, user_id: str, course_id: str) -> None:
    """Raise 404 unless ``course_id`` belongs to the current user.

    Used before creating a child row (note, material, ...) so a user
    cannot attach their content to somebody else's course.
    """
    try:
        result = (
            client.table("courses")
            .select("id")
            .eq("id", course_id)
            .eq("user_id", user_id)
            .maybe_single()
            .execute()
        )
    except PostgrestAPIError as exc:
        raise _db_error(exc) from exc

    if getattr(result, "data", None) is None:
        raise HTTPException(status_code=404, detail="Course not found")


def list_items(
    client: Client,
    user_id: str,
    table: str,
    *,
    course_id: str | None = None,
    order_by: str = "created_at",
) -> list[dict]:
    """Return only the current user's rows (optionally for one course)."""
    query = client.table(table).select("*").eq("user_id", user_id)
    if course_id is not None:
        query = query.eq("course_id", course_id)
    try:
        result = query.order(order_by, desc=True).execute()
    except PostgrestAPIError as exc:
        raise _db_error(exc) from exc
    return list(result.data or [])


def get_item(client: Client, user_id: str, table: str, item_id: str) -> dict:
    """Fetch one of the current user's rows, or 404."""
    try:
        result = (
            client.table(table)
            .select("*")
            .eq("id", item_id)
            .eq("user_id", user_id)
            .maybe_single()
            .execute()
        )
    except PostgrestAPIError as exc:
        raise _db_error(exc) from exc

    data = getattr(result, "data", None)
    if data is None:
        raise HTTPException(status_code=404, detail="Not found")
    return data


def create_item(client: Client, user_id: str, table: str, values: dict) -> dict:
    """Insert a row owned by the current user."""
    payload = {**values, "user_id": user_id}
    try:
        result = client.table(table).insert(payload).execute()
    except PostgrestAPIError as exc:
        raise _db_error(exc) from exc

    if not result.data:
        raise HTTPException(status_code=500, detail="Could not create record")
    return result.data[0]


def update_item(
    client: Client, user_id: str, table: str, item_id: str, changes: dict
) -> dict:
    """Update one of the current user's rows, or 404."""
    if not changes:
        raise HTTPException(status_code=400, detail="No fields to update")

    try:
        result = (
            client.table(table)
            .update(changes)
            .eq("id", item_id)
            .eq("user_id", user_id)
            .execute()
        )
    except PostgrestAPIError as exc:
        raise _db_error(exc) from exc

    if not result.data:
        raise HTTPException(status_code=404, detail="Not found")
    return result.data[0]


def delete_item(client: Client, user_id: str, table: str, item_id: str) -> None:
    """Delete one of the current user's rows, or 404."""
    try:
        result = (
            client.table(table)
            .delete()
            .eq("id", item_id)
            .eq("user_id", user_id)
            .execute()
        )
    except PostgrestAPIError as exc:
        raise _db_error(exc) from exc

    if not result.data:
        raise HTTPException(status_code=404, detail="Not found")
