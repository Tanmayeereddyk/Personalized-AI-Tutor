"""Course endpoints.

All routes here require authentication (get_current_user -> 401 otherwise).
The user id always comes from the validated token, never from the body,
so users can only ever touch their own courses.
"""

from fastapi import APIRouter, Depends, Response
from supabase import Client

from app.api.dependencies import get_current_user, get_service_supabase
from app.schemas.auth import AuthUser
from app.schemas.course import CourseCreate, CourseResponse, CourseUpdate
from app.services import course_service

router = APIRouter(tags=["courses"])


@router.post("/api/courses", response_model=CourseResponse, status_code=201)
def create_course(
    payload: CourseCreate,
    user: AuthUser = Depends(get_current_user),
    db: Client = Depends(get_service_supabase),
) -> CourseResponse:
    """Create a course owned by the logged-in user."""
    return course_service.create_course(db, user.id, payload)


@router.get("/api/courses", response_model=list[CourseResponse])
def list_courses(
    user: AuthUser = Depends(get_current_user),
    db: Client = Depends(get_service_supabase),
) -> list[CourseResponse]:
    """List the logged-in user's courses only."""
    return course_service.list_courses(db, user.id)


@router.get("/api/courses/{course_id}", response_model=CourseResponse)
def get_course(
    course_id: str,
    user: AuthUser = Depends(get_current_user),
    db: Client = Depends(get_service_supabase),
) -> CourseResponse:
    """Fetch one of the logged-in user's courses (404 otherwise)."""
    return course_service.get_course(db, user.id, course_id)


@router.put("/api/courses/{course_id}", response_model=CourseResponse)
def update_course(
    course_id: str,
    payload: CourseUpdate,
    user: AuthUser = Depends(get_current_user),
    db: Client = Depends(get_service_supabase),
) -> CourseResponse:
    """Update one of the logged-in user's courses (404 otherwise)."""
    return course_service.update_course(db, user.id, course_id, payload)


@router.delete("/api/courses/{course_id}", status_code=204)
def delete_course(
    course_id: str,
    user: AuthUser = Depends(get_current_user),
    db: Client = Depends(get_service_supabase),
) -> Response:
    """Delete one of the logged-in user's courses (404 otherwise)."""
    course_service.delete_course(db, user.id, course_id)
    return Response(status_code=204)
