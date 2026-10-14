"""Generic ownership-safe CRUD for per-user learning data.

Every function takes the authenticated user's id (from the validated
token, never from the request body) and adds ``.eq("user_id", user_id)``
to the query. A record that belongs to somebody else simply does not
match, so it is reported as 404 — the same as a record that does not
exist. This is the single place the ownership rule is implemented, so
notes, quizzes, decks, events and bookmarks all behave the same way.
"""

from fastapi import HTTPException
from supabase import Client, PostgrestAPIError


def _db_error(exc: PostgrestAPIError, *, table: str | None = None) -> HTTPException:
    """Map a PostgREST failure to a clear, actionable HTTP error.

    Only a missing table/column is fixed by running the SQL in ``database/``,
    so name what is missing. A constraint violation or any other failure is a
    data/transient problem and must not be blamed on the schema.
    """
    code = getattr(exc, "code", None)
    if code in {"42P01", "PGRST205"}:
        target = f"The '{table}' table" if table else "A required database table"
        detail = (
            f"{target} is missing. Run database/schema.sql and the migrations in "
            "database/migrations/ in your Supabase project, then try again."
        )
    elif code in {"42703", "PGRST204"}:
        detail = (
            "A required database column is missing. Run the latest migration in "
            "database/migrations/ in your Supabase project, then try again."
        )
    else:
        detail = "Database error. Please try again."
    return HTTPException(status_code=500, detail=detail)


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
        raise _db_error(exc, table="courses") from exc

    if getattr(result, "data", None) is None:
        raise HTTPException(status_code=404, detail="Course not found")


def list_items(
    client: Client,
    user_id: str,
    table: str,
    *,
    course_id: str | None = None,
    deck_id: str | None = None,
    order_by: str = "created_at",
) -> list[dict]:
    """Return only the current user's rows (optionally for one course/deck)."""
    query = client.table(table).select("*").eq("user_id", user_id)
    if course_id is not None:
        query = query.eq("course_id", course_id)
    if deck_id is not None:
        query = query.eq("deck_id", deck_id)
    try:
        result = query.order(order_by, desc=True).execute()
    except PostgrestAPIError as exc:
        raise _db_error(exc, table=table) from exc
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
        raise _db_error(exc, table=table) from exc

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
        raise _db_error(exc, table=table) from exc

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
        raise _db_error(exc, table=table) from exc

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
        raise _db_error(exc, table=table) from exc

    if not result.data:
        raise HTTPException(status_code=404, detail="Not found")

def ensure_deck_owned(client, user_id, deck_id):
    try:
        result = client.table("flashcard_decks").select("id,user_id,course_id").eq("id",deck_id).eq("user_id",user_id).maybe_single().execute()
    except Exception as exc:
        from fastapi import HTTPException
        from supabase import PostgrestAPIError
        if isinstance(exc, PostgrestAPIError):
            raise HTTPException(status_code=500, detail="Database error. Run database/schema.sql in Supabase first.") from exc
        raise
    if getattr(result,"data",None) is None:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Deck not found")
    return result.data

def update_deck_card_count(client, user_id, deck_id):
    try:
        cnt = client.table("flashcards").select("id", count="exact").eq("user_id",user_id).eq("deck_id",deck_id).execute()
        count = getattr(cnt,"count",0) or (len(cnt.data or []))
    except Exception as exc:
        from fastapi import HTTPException
        from supabase import PostgrestAPIError
        if isinstance(exc, PostgrestAPIError):
            raise HTTPException(status_code=500, detail="Database error. Run database/schema.sql in Supabase first.") from exc
        raise
    try:
        client.table("flashcard_decks").update({"card_count": count}).eq("id",deck_id).eq("user_id",user_id).execute()
    except Exception as exc:
        from fastapi import HTTPException
        from supabase import PostgrestAPIError
        if isinstance(exc, PostgrestAPIError):
            raise HTTPException(status_code=500, detail="Database error. Run database/schema.sql in Supabase first.") from exc
        raise
