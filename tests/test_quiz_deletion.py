"""Tests for deleting a saved quiz attempt.

Quiz deletion reuses the ownership-safe, course-scoped CRUD in
``app.api.routes.learning`` (``DELETE /api/quizzes/{item_id}``). These tests
prove the owner can delete their own quiz, another user cannot (they get 404,
never 403-with-existence-leak), a missing quiz is a 404, and deleting a quiz
never touches the course's source materials or generated topics.
"""

import uuid
from datetime import datetime, timezone

from app.main import app

ITEMS = "/api/quizzes/{item_id}"
COLLECTION = "/api/courses/{course_id}/quizzes"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _course(client, headers, name="Physics") -> str:
    response = client.post("/api/courses", json={"name": name}, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _upload_material(client, headers, course_id, name="lecture.pdf") -> str:
    response = client.post(
        f"/api/courses/{course_id}/materials",
        files=[("files", (name, b"pdf-bytes", "application/pdf"))],
        headers=headers,
    )
    assert response.status_code == 201, response.text
    return response.json()[0]["id"]


def _seed_topic(fake, *, user_id, course_id, material_id, name="Ohm's Law") -> str:
    row = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "course_id": course_id,
        "name": name,
        "description": "A topic.",
        "topic_group": None,
        "prerequisite": None,
        "resource_count": 1,
        "source_material_ids": [material_id],
        "generated": True,
        "generation_method": "llm",
        "created_at": _now(),
        "updated_at": _now(),
    }
    fake.tables.setdefault("topics", []).append(row)
    return row["id"]


def _create_quiz(client, headers, course_id, name="Midterm quiz") -> dict:
    response = client.post(
        COLLECTION.format(course_id=course_id),
        json={"name": name, "topic": "Ohm's Law", "difficulty": "Medium", "score": 4, "total": 5},
        headers=headers,
    )
    assert response.status_code == 201, response.text
    return response.json()


# ---------------------------------------------------------------
# Route + auth
# ---------------------------------------------------------------

def test_quiz_delete_route_is_registered() -> None:
    assert "/api/quizzes/{item_id}" in set(app.openapi()["paths"])
    assert "delete" in app.openapi()["paths"]["/api/quizzes/{item_id}"]


def test_delete_requires_authentication(client) -> None:
    assert client.delete(ITEMS.format(item_id="anything")).status_code == 401


# ---------------------------------------------------------------
# Ownership
# ---------------------------------------------------------------

def test_owner_can_delete_their_quiz(client, logged_in_user) -> None:
    _user, headers = logged_in_user
    course_id = _course(client, headers)
    quiz = _create_quiz(client, headers, course_id)

    response = client.delete(ITEMS.format(item_id=quiz["id"]), headers=headers)

    assert response.status_code == 204, response.text
    remaining = client.get(COLLECTION.format(course_id=course_id), headers=headers).json()
    assert remaining == []


def test_another_user_cannot_delete_the_quiz(client, fake_supabase, logged_in_user) -> None:
    owner, owner_headers = logged_in_user
    course_id = _course(client, owner_headers)
    quiz = _create_quiz(client, owner_headers, course_id)

    # A second, unrelated account.
    signup = client.post(
        "/api/auth/signup",
        json={"email": "mallory@example.com", "password": "password123", "full_name": "M"},
    )
    assert signup.status_code == 201, signup.text
    intruder = {"Authorization": f"Bearer {signup.json()['access_token']}"}

    response = client.delete(ITEMS.format(item_id=quiz["id"]), headers=intruder)

    # The row is invisible to the other user, so it is reported as not found —
    # never deleted, and never confirmed to exist.
    assert response.status_code == 404, response.text
    still_there = client.get(COLLECTION.format(course_id=course_id), headers=owner_headers).json()
    assert [row["id"] for row in still_there] == [quiz["id"]]


def test_deleting_a_missing_quiz_is_a_404(client, logged_in_user) -> None:
    _user, headers = logged_in_user
    response = client.delete(ITEMS.format(item_id=str(uuid.uuid4())), headers=headers)
    assert response.status_code == 404


def test_deleting_the_same_quiz_twice_is_a_404(client, logged_in_user) -> None:
    _user, headers = logged_in_user
    course_id = _course(client, headers)
    quiz = _create_quiz(client, headers, course_id)

    assert client.delete(ITEMS.format(item_id=quiz["id"]), headers=headers).status_code == 204
    # A duplicate delete (e.g. a double-click that slipped through) is a clean 404.
    assert client.delete(ITEMS.format(item_id=quiz["id"]), headers=headers).status_code == 404


# ---------------------------------------------------------------
# Related records are untouched
# ---------------------------------------------------------------

def test_deleting_a_quiz_keeps_materials_and_topics(
    client, fake_supabase, logged_in_user
) -> None:
    user, headers = logged_in_user
    course_id = _course(client, headers)
    material_id = _upload_material(client, headers, course_id)
    topic_id = _seed_topic(fake_supabase, user_id=user.id, course_id=course_id, material_id=material_id)
    quiz = _create_quiz(client, headers, course_id)

    assert client.delete(ITEMS.format(item_id=quiz["id"]), headers=headers).status_code == 204

    # The source material and the generated topic still exist.
    materials = client.get(f"/api/courses/{course_id}/materials", headers=headers).json()
    assert [m["id"] for m in materials] == [material_id]
    topics = client.get(f"/api/courses/{course_id}/topics", headers=headers).json()
    assert [t["id"] for t in topics] == [topic_id]
