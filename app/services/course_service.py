"""Course business logic.

Every function receives the authenticated user's id from the route layer
(never from the request body), and every query filters by it — so a user
can only ever see, change, or delete their own courses.
"""

from fastapi import HTTPException
from supabase import Client, PostgrestAPIError

from app.schemas.course import CourseCreate, CourseResponse, CourseUpdate


def _db_error(exc: PostgrestAPIError) -> HTTPException:
    """Turn Supabase table errors into a friendly HTTP error."""
    return HTTPException(
        status_code=500,
        detail="Database error. Run database/schema.sql in Supabase first.",
    )


def create_course(client: Client, user_id: str, payload: CourseCreate) -> CourseResponse:
    """Insert a course owned by the current user."""
    try:
        result = (
            client.table("courses")
            .insert(
                {
                    "user_id": user_id,
                    "name": payload.name,
                    "description": payload.description,
                }
            )
            .execute()
        )
    except PostgrestAPIError as exc:
        raise _db_error(exc) from exc

    return CourseResponse.model_validate(result.data[0])


def list_courses(client: Client, user_id: str) -> list[CourseResponse]:
    """List only the current user's courses (newest first)."""
    try:
        result = (
            client.table("courses")
            .select("*")
            .eq("user_id", user_id)
            .order("created_at", desc=True)
            .execute()
        )
    except PostgrestAPIError as exc:
        raise _db_error(exc) from exc

    return [CourseResponse.model_validate(row) for row in result.data]


def get_course(client: Client, user_id: str, course_id: str) -> CourseResponse:
    """Fetch one course, but only if it belongs to the current user.

    Another user's course id returns 404 (not 403), so we never confirm
    that it exists.
    """
    try:
        result = (
            client.table("courses")
            .select("*")
            .eq("id", course_id)
            .eq("user_id", user_id)
            .maybe_single()
            .execute()
        )
    except PostgrestAPIError as exc:
        raise _db_error(exc) from exc

    data = getattr(result, "data", None)
    if data is None:
        raise HTTPException(status_code=404, detail="Course not found")

    return CourseResponse.model_validate(data)


def update_course(
    client: Client, user_id: str, course_id: str, payload: CourseUpdate
) -> CourseResponse:
    """Update the current user's course (only the fields that were sent)."""
    changes = payload.model_dump(exclude_unset=True)
    if not changes:
        raise HTTPException(status_code=400, detail="No fields to update")

    try:
        result = (
            client.table("courses")
            .update(changes)
            .eq("id", course_id)
            .eq("user_id", user_id)
            .execute()
        )
    except PostgrestAPIError as exc:
        raise _db_error(exc) from exc

    if not result.data:
        raise HTTPException(status_code=404, detail="Course not found")

    return CourseResponse.model_validate(result.data[0])


def delete_course(client: Client, user_id: str, course_id: str) -> None:
    """Delete the current user's course."""
    try:
        result = (
            client.table("courses")
            .delete()
            .eq("id", course_id)
            .eq("user_id", user_id)
            .execute()
        )
    except PostgrestAPIError as exc:
        raise _db_error(exc) from exc

    if not result.data:
        raise HTTPException(status_code=404, detail="Course not found")
