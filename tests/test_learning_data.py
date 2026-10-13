"""Ownership tests for materials and per-user learning data.

The security property: every resource (materials, notes, quizzes,
flashcard decks, calendar events, bookmarks) is scoped to
the authenticated user. A second user must never be able to list, read,
update or delete the first user's rows — even when a record id is known.
"""

import pytest

from app.main import app
from tests.conftest import create_user


def _course(client, headers, name="Physics") -> str:
    response = client.post("/api/courses", json={"name": name}, headers=headers)
    assert response.status_code == 201
    return response.json()["id"]


COURSE_SCOPED = [
    # (segment, create_body)
    ("notes", {"title": "Chapter 1"}),
    ("quizzes", {"name": "Warm-up"}),
    ("flashcard-decks", {"topic": "Photosynthesis"}),
]

USER_SCOPED = [
    ("calendar-events", {"title": "Study block", "event_date": "2026-10-12"}),
    ("bookmarks", {"title": "Khan Academy", "url": "https://example.com"}),
]


# ---------------------------------------------------------------
# Routes registered
# ---------------------------------------------------------------
def test_new_routes_registered() -> None:
    paths = set(app.openapi()["paths"])
    expected = {
        "/api/courses/{course_id}/materials",
        "/api/materials/{material_id}",
        "/api/materials/{material_id}/url",
        "/api/courses/{course_id}/notes",
        "/api/notes/{item_id}",
        "/api/courses/{course_id}/quizzes",
        "/api/quizzes/{item_id}",
        "/api/courses/{course_id}/flashcard-decks",
        "/api/flashcard-decks/{item_id}",
        "/api/calendar-events",
        "/api/calendar-events/{item_id}",
        "/api/bookmarks",
        "/api/bookmarks/{item_id}",
    }
    missing = expected - paths
    assert not missing, f"routes missing: {missing}"


# ---------------------------------------------------------------
# Authentication is required everywhere
# ---------------------------------------------------------------
@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/api/courses/some-id/materials"),
        ("POST", "/api/courses/some-id/materials"),
        ("GET", "/api/materials/material-1"),
        ("DELETE", "/api/materials/material-1"),
        ("GET", "/api/courses/some-id/notes"),
        ("GET", "/api/notes/note-1"),
        ("GET", "/api/calendar-events"),
        ("GET", "/api/bookmarks"),
    ],
)
def test_learning_endpoints_require_authentication(client, method, path) -> None:
    assert client.request(method, path).status_code == 401


# ---------------------------------------------------------------
# Materials
# ---------------------------------------------------------------
def test_upload_list_and_read_material(client, logged_in_user) -> None:
    _, headers = logged_in_user
    course_id = _course(client, headers)

    response = client.post(
        f"/api/courses/{course_id}/materials",
        files=[("files", ("lecture.pdf", b"pdf-bytes", "application/pdf"))],
        headers=headers,
    )
    assert response.status_code == 201, response.text
    material = response.json()[0]
    assert material["name"] == "lecture.pdf"
    assert material["type"] == "pdf"
    assert material["size_bytes"] == len(b"pdf-bytes")
    assert material["course_id"] == course_id

    listed = client.get(f"/api/courses/{course_id}/materials", headers=headers)
    assert listed.status_code == 200
    assert [m["id"] for m in listed.json()] == [material["id"]]

    single = client.get(f"/api/materials/{material['id']}", headers=headers)
    assert single.status_code == 200
    assert single.json()["id"] == material["id"]

    url = client.get(f"/api/materials/{material['id']}/url", headers=headers)
    assert url.status_code == 200
    assert url.json()["url"].startswith("https://")


def test_upload_to_another_users_course_is_404(client, fake_supabase, logged_in_user) -> None:
    _, headers = logged_in_user
    other, other_headers = create_user(fake_supabase, email="other@example.com")
    their_course = client.post("/api/courses", json={"name": "Theirs"}, headers=other_headers).json()

    response = client.post(
        f"/api/courses/{their_course['id']}/materials",
        files=[("files", ("x.pdf", b"x", "application/pdf"))],
        headers=headers,
    )
    assert response.status_code == 404


def test_cannot_read_another_users_material(client, fake_supabase, logged_in_user) -> None:
    _, headers = logged_in_user
    _, other_headers = create_user(fake_supabase, email="other@example.com")
    their_course = client.post("/api/courses", json={"name": "Theirs"}, headers=other_headers).json()
    material = client.post(
        f"/api/courses/{their_course['id']}/materials",
        files=[("files", ("secret.pdf", b"secret", "application/pdf"))],
        headers=other_headers,
    ).json()[0]

    assert client.get(f"/api/materials/{material['id']}", headers=headers).status_code == 404
    assert client.delete(f"/api/materials/{material['id']}", headers=headers).status_code == 404
    assert (
        client.get(f"/api/materials/{material['id']}/url", headers=headers).status_code == 404
    )


def test_delete_material_removes_file_and_row(client, fake_supabase, logged_in_user) -> None:
    _, headers = logged_in_user
    course_id = _course(client, headers)
    material = client.post(
        f"/api/courses/{course_id}/materials",
        files=[("files", ("gone.pdf", b"bye", "application/pdf"))],
        headers=headers,
    ).json()[0]

    assert fake_supabase.stored_objects  # uploaded to fake storage

    assert client.delete(f"/api/materials/{material['id']}", headers=headers).status_code == 204
    assert client.get(f"/api/materials/{material['id']}", headers=headers).status_code == 404
    assert not fake_supabase.stored_objects  # object was removed too


# ---------------------------------------------------------------
# Course-scoped learning resources (notes/quizzes/decks)
# ---------------------------------------------------------------
@pytest.mark.parametrize(("segment", "body"), COURSE_SCOPED)
def test_course_scoped_crud(client, logged_in_user, segment, body) -> None:
    user, headers = logged_in_user
    course_id = _course(client, headers)

    created = client.post(f"/api/courses/{course_id}/{segment}", json=body, headers=headers)
    assert created.status_code == 201, created.text
    item = created.json()
    assert item["user_id"] == user.id
    assert item["course_id"] == course_id

    listed = client.get(f"/api/courses/{course_id}/{segment}", headers=headers)
    assert listed.status_code == 200
    assert [row["id"] for row in listed.json()] == [item["id"]]

    single = client.get(f"/api/{segment}/{item['id']}", headers=headers)
    assert single.status_code == 200

    assert client.delete(f"/api/{segment}/{item['id']}", headers=headers).status_code == 204
    assert client.get(f"/api/{segment}/{item['id']}", headers=headers).status_code == 404


@pytest.mark.parametrize(("segment", "body"), COURSE_SCOPED)
def test_cannot_touch_another_users_course_scoped_item(
    client, fake_supabase, logged_in_user, segment, body
) -> None:
    _, headers = logged_in_user
    _, other_headers = create_user(fake_supabase, email="other@example.com")
    their_course = client.post("/api/courses", json={"name": "Theirs"}, headers=other_headers).json()

    # Cannot attach content to a course that is not mine.
    assert (
        client.post(f"/api/courses/{their_course['id']}/{segment}", json=body, headers=headers).status_code
        == 404
    )
    # Cannot list another user's course resources.
    assert (
        client.get(f"/api/courses/{their_course['id']}/{segment}", headers=headers).status_code == 404
    )

    item = client.post(
        f"/api/courses/{their_course['id']}/{segment}", json=body, headers=other_headers
    ).json()
    assert client.get(f"/api/{segment}/{item['id']}", headers=headers).status_code == 404
    assert client.delete(f"/api/{segment}/{item['id']}", headers=headers).status_code == 404


# ---------------------------------------------------------------
# User-scoped resources (calendar events, bookmarks)
# ---------------------------------------------------------------
@pytest.mark.parametrize(("segment", "body"), USER_SCOPED)
def test_user_scoped_crud(client, logged_in_user, segment, body) -> None:
    user, headers = logged_in_user
    created = client.post(f"/api/{segment}", json=body, headers=headers)
    assert created.status_code == 201, created.text
    item = created.json()
    assert item["user_id"] == user.id

    listed = client.get(f"/api/{segment}", headers=headers)
    assert listed.status_code == 200
    assert [row["id"] for row in listed.json()] == [item["id"]]

    assert client.delete(f"/api/{segment}/{item['id']}", headers=headers).status_code == 204


@pytest.mark.parametrize(("segment", "body"), USER_SCOPED)
def test_cannot_touch_another_users_personal_item(
    client, fake_supabase, logged_in_user, segment, body
) -> None:
    _, headers = logged_in_user
    _, other_headers = create_user(fake_supabase, email="other@example.com")
    item = client.post(f"/api/{segment}", json=body, headers=other_headers).json()

    assert client.get(f"/api/{segment}", headers=headers).json() == []  # not listed
    assert client.get(f"/api/{segment}/{item['id']}", headers=headers).status_code == 404
    assert client.delete(f"/api/{segment}/{item['id']}", headers=headers).status_code == 404


def test_event_with_another_users_course_is_404(client, fake_supabase, logged_in_user) -> None:
    _, headers = logged_in_user
    _, other_headers = create_user(fake_supabase, email="other@example.com")
    their_course = client.post("/api/courses", json={"name": "Theirs"}, headers=other_headers).json()

    response = client.post(
        "/api/calendar-events",
        json={"title": "Sneaky", "event_date": "2026-10-12", "course_id": their_course["id"]},
        headers=headers,
    )
    assert response.status_code == 404
