"""End-to-end multi-user scenarios, driven through the real HTTP endpoints.

This mirrors the acceptance checklist for the multi-user conversion:

  1. a brand-new account sees an *empty* course library (not demo data)
  2. User A's course is visible to User A
  3. User B (also brand new) still sees an empty library
  4. User B cannot reach User A's course by id
  5. logging out and logging back in on the same "browser" never leaks the
     other account's data
  6. refreshing the page preserves what is actually stored in the database
  7. signup, login and the email-confirmation flow still work

A "browser" here is one TestClient whose Bearer token we swap — exactly what
the frontend does when one user logs out and another logs in. Supabase itself
is replaced by the fake client in conftest.py, so this runs fully offline; the
only thing faked is the database, not the backend's ownership logic.
"""

from tests.conftest import create_user


def _signup(client, email: str, name: str = "Test User") -> dict[str, str]:
    response = client.post(
        "/api/auth/signup",
        json={"email": email, "password": "password123", "full_name": name},
    )
    assert response.status_code == 201, response.text
    token = response.json()["access_token"]
    assert token, "signup should return a session when confirmation is off"
    return {"Authorization": f"Bearer {token}"}


def _login(client, email: str) -> dict[str, str]:
    response = client.post(
        "/api/auth/login", json={"email": email, "password": "password123"}
    )
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def _create_course(client, headers: dict[str, str], name: str) -> dict:
    response = client.post("/api/courses", json={"name": name}, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


def test_new_account_sees_empty_library(client) -> None:
    """1. A fresh user gets an empty list, never demo/sample courses."""
    headers = _signup(client, "fresh@example.com")
    response = client.get("/api/courses", headers=headers)
    assert response.status_code == 200
    assert response.json() == []


def test_two_accounts_are_fully_isolated(client) -> None:
    """2-4. A owns A's course; B is empty and cannot reach A's course."""
    a_headers = _signup(client, "alice@example.com", "Alice")
    course_a = _create_course(client, a_headers, "Alice's Course")

    # 2. A sees exactly their own course.
    a_list = client.get("/api/courses", headers=a_headers).json()
    assert [c["id"] for c in a_list] == [course_a["id"]]

    # 3. B is brand new and sees nothing.
    b_headers = _signup(client, "bob@example.com", "Bob")
    assert client.get("/api/courses", headers=b_headers).json() == []

    # 4. B cannot reach A's course by id — 404, and not a 403 that confirms it exists.
    assert client.get(f"/api/courses/{course_a['id']}", headers=b_headers).status_code == 404
    assert (
        client.put(f"/api/courses/{course_a['id']}", json={"name": "Hacked"}, headers=b_headers).status_code
        == 404
    )
    assert client.delete(f"/api/courses/{course_a['id']}", headers=b_headers).status_code == 404
    # Course-scoped data under A's course is also unreachable to B.
    assert (
        client.get(f"/api/courses/{course_a['id']}/materials", headers=b_headers).status_code == 404
    )
    assert client.get(f"/api/courses/{course_a['id']}/notes", headers=b_headers).status_code == 404


def test_logout_and_relogin_never_leaks_other_account(client) -> None:
    """5. Same browser, two accounts: no cross-contamination across logins."""
    a_headers = _signup(client, "alice@example.com", "Alice")
    course_a = _create_course(client, a_headers, "Alice's Course")
    _signup(client, "bob@example.com", "Bob")  # B exists too

    # A logs out (the frontend also drops the token after this).
    assert client.post("/api/auth/logout", headers=a_headers).status_code == 200

    # B logs in on the same browser: still an empty library, no trace of A.
    b_headers = _login(client, "bob@example.com")
    assert client.get("/api/courses", headers=b_headers).json() == []

    # A logs back in: their course is still there and still theirs.
    a_again = _login(client, "alice@example.com")
    a_list = client.get("/api/courses", headers=a_again).json()
    assert [c["id"] for c in a_list] == [course_a["id"]]
    assert all(c["user_id"] == a_list[0]["user_id"] for c in a_list)


def test_refresh_preserves_database_rows(client) -> None:
    """6. Re-fetching (a page refresh) returns exactly what was saved."""
    headers = _signup(client, "student@example.com")
    created = _create_course(client, headers, "Persisted Course")

    first = client.get("/api/courses", headers=headers).json()
    second = client.get("/api/courses", headers=headers).json()  # the "refresh"
    assert [c["id"] for c in first] == [c["id"] for c in second] == [created["id"]]
    assert all(c["name"] == "Persisted Course" for c in second)


def test_failed_request_is_not_an_empty_library(client) -> None:
    """An auth failure must be a 401, so the UI can't mistake it for 'no courses'."""
    assert client.get("/api/courses").status_code == 401
    assert (
        client.get("/api/courses", headers={"Authorization": "Bearer bogus"}).status_code == 401
    )


def test_auth_flows_still_work(client, fake_supabase) -> None:
    """7. signup, login and the email-confirmation branch are intact."""
    # Password / payload validation.
    assert client.post("/api/auth/signup", json={"email": "x@example.com"}).status_code == 422

    # Wrong password is rejected.
    _signup(client, "ada@example.com")
    assert (
        client.post(
            "/api/auth/login", json={"email": "ada@example.com", "password": "nope"}
        ).status_code
        == 401
    )

    # Happy-path login returns a working token that /me accepts.
    headers = _login(client, "ada@example.com")
    me = client.get("/api/auth/me", headers=headers)
    assert me.status_code == 200
    assert me.json()["user"]["email"] == "ada@example.com"

    # When confirmation is required, signup succeeds but hands back no session.
    fake_supabase.auth.require_email_confirmation = True
    response = client.post(
        "/api/auth/signup", json={"email": "pending@example.com", "password": "password123"}
    )
    assert response.status_code == 201
    assert response.json()["access_token"] is None
    assert "confirm" in response.json()["message"].lower()
