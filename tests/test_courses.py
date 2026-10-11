"""Tests for the course endpoints (auth is faked via conftest.py).

Key security property being tested: a user can only ever see or modify
their own courses — even if they guess another user's course id.
"""

import uuid
from datetime import datetime, timezone

import pytest

from app.main import app
from app.schemas.course import CourseResponse
from tests.conftest import create_user

COURSE_PATHS = {
    "/api/courses",
    "/api/courses/{course_id}",
}


def test_course_routes_registered() -> None:
    """All five course routes must be present in the app."""
    openapi_paths = app.openapi()["paths"]
    assert COURSE_PATHS <= set(openapi_paths)
    assert {"post", "get"} <= set(openapi_paths["/api/courses"])
    assert {"get", "put", "delete"} <= set(openapi_paths["/api/courses/{course_id}"])


# ---------------------------------------------------------------
# Unauthenticated access must return 401 (before any DB call)
# ---------------------------------------------------------------
@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("POST", "/api/courses"),
        ("GET", "/api/courses"),
        ("GET", "/api/courses/some-id"),
        ("PUT", "/api/courses/some-id"),
        ("DELETE", "/api/courses/some-id"),
    ],
)
def test_course_endpoints_require_authentication(client, method: str, path: str) -> None:
    response = client.request(method, path, json={"name": "Math"})
    assert response.status_code == 401


def test_course_endpoints_reject_invalid_token(client) -> None:
    headers = {"Authorization": "Bearer bogus-token"}
    assert client.get("/api/courses", headers=headers).status_code == 401


# ---------------------------------------------------------------
# CRUD (happy paths)
# ---------------------------------------------------------------
def test_create_course_returns_course_shape(client, logged_in_user) -> None:
    user, headers = logged_in_user
    response = client.post(
        "/api/courses",
        json={"name": "Algebra 101", "description": "Intro to algebra"},
        headers=headers,
    )

    assert response.status_code == 201
    data = response.json()
    assert set(data) == {
        "id",
        "user_id",
        "name",
        "code",
        "description",
        "color",
        "icon",
        "created_at",
        "updated_at",
    }
    assert data["name"] == "Algebra 101"
    assert data["user_id"] == user.id  # owner comes from the token, not the body
    assert data["code"] == "A1"  # derived from the name when not supplied
    assert data["color"] == "mint"  # palette defaults are always valid
    assert data["icon"] == "book"


def test_list_courses_returns_only_my_courses(client, fake_supabase, logged_in_user) -> None:
    _, headers = logged_in_user

    # Another user's course sits in the same table.
    other_user, _ = create_user(fake_supabase, email="other@example.com")
    fake_supabase.tables.setdefault("courses", []).append(
        {
            "id": str(uuid.uuid4()),
            "user_id": other_user.id,
            "name": "Other's course",
            "description": None,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
    )

    client.post("/api/courses", json={"name": "Mine A"}, headers=headers)
    client.post("/api/courses", json={"name": "Mine B"}, headers=headers)

    response = client.get("/api/courses", headers=headers)
    assert response.status_code == 200
    names = [course["name"] for course in response.json()]
    assert names == ["Mine B", "Mine A"]  # newest first
    assert "Other's course" not in names


def test_get_my_course(client, logged_in_user) -> None:
    _, headers = logged_in_user
    created = client.post("/api/courses", json={"name": "Physics"}, headers=headers).json()

    response = client.get(f"/api/courses/{created['id']}", headers=headers)
    assert response.status_code == 200
    assert response.json()["name"] == "Physics"


def test_update_my_course(client, logged_in_user) -> None:
    _, headers = logged_in_user
    created = client.post(
        "/api/courses", json={"name": "Old name", "description": "keep me"}, headers=headers
    ).json()

    response = client.put(
        f"/api/courses/{created['id']}", json={"name": "New name"}, headers=headers
    )
    assert response.status_code == 200
    data = response.json()
    assert data["name"] == "New name"
    assert data["description"] == "keep me"  # untouched fields stay the same


def test_delete_my_course(client, logged_in_user) -> None:
    _, headers = logged_in_user
    created = client.post("/api/courses", json={"name": "Doomed"}, headers=headers).json()

    response = client.delete(f"/api/courses/{created['id']}", headers=headers)
    assert response.status_code == 204

    # Gone now: fetching it returns 404.
    assert client.get(f"/api/courses/{created['id']}", headers=headers).status_code == 404


# ---------------------------------------------------------------
# Ownership: another user's course is invisible (404, not 403)
# ---------------------------------------------------------------
def _seed_course(fake, user_id: str) -> str:
    course_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    fake.tables.setdefault("courses", []).append(
        {
            "id": course_id,
            "user_id": user_id,
            "name": "Someone else's course",
            "description": None,
            "created_at": now,
            "updated_at": now,
        }
    )
    return course_id


def test_cannot_get_another_users_course(client, fake_supabase, logged_in_user) -> None:
    _, headers = logged_in_user
    other_user, _ = create_user(fake_supabase, email="other@example.com")
    course_id = _seed_course(fake_supabase, other_user.id)

    assert client.get(f"/api/courses/{course_id}", headers=headers).status_code == 404


def test_cannot_update_another_users_course(client, fake_supabase, logged_in_user) -> None:
    _, headers = logged_in_user
    other_user, _ = create_user(fake_supabase, email="other@example.com")
    course_id = _seed_course(fake_supabase, other_user.id)

    response = client.put(f"/api/courses/{course_id}", json={"name": "Hacked"}, headers=headers)
    assert response.status_code == 404


def test_cannot_delete_another_users_course(client, fake_supabase, logged_in_user) -> None:
    _, headers = logged_in_user
    other_user, _ = create_user(fake_supabase, email="other@example.com")
    course_id = _seed_course(fake_supabase, other_user.id)

    assert client.delete(f"/api/courses/{course_id}", headers=headers).status_code == 404
    # Still there in the database.
    assert any(r["id"] == course_id for r in fake_supabase.tables["courses"])


# ---------------------------------------------------------------
# Request validation
# ---------------------------------------------------------------
def test_create_course_without_name_is_422(client, logged_in_user) -> None:
    _, headers = logged_in_user
    assert client.post("/api/courses", json={"description": "no name"}, headers=headers).status_code == 422


def test_create_course_with_empty_name_is_422(client, logged_in_user) -> None:
    _, headers = logged_in_user
    assert client.post("/api/courses", json={"name": ""}, headers=headers).status_code == 422


def test_update_course_with_no_fields_is_400(client, logged_in_user) -> None:
    _, headers = logged_in_user
    created = client.post("/api/courses", json={"name": "Valid"}, headers=headers).json()
    response = client.put(f"/api/courses/{created['id']}", json={}, headers=headers)
    assert response.status_code == 400


# ---------------------------------------------------------------
# Response schema
# ---------------------------------------------------------------
def test_course_response_schema_validates() -> None:
    course = CourseResponse(
        id="c1",
        user_id="u1",
        name="Biology",
        description=None,
        created_at="2026-10-07T10:00:00+00:00",
        updated_at="2026-10-07T10:00:00+00:00",
    )
    assert course.name == "Biology"
    assert course.description is None
