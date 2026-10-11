"""Tests for the auth endpoints.

Everything runs against the fake Supabase client from conftest.py —
no real Supabase account or keys are required.
"""

import pytest
from pydantic import ValidationError

from app.main import app
from app.schemas.auth import AuthUser, SessionResponse, SignupRequest
from tests.conftest import create_user

AUTH_PATHS = {"/api/auth/signup", "/api/auth/login", "/api/auth/me", "/api/auth/logout"}


def test_auth_routes_registered() -> None:
    """All four auth routes must be present in the app."""
    paths = set(app.openapi()["paths"])
    assert AUTH_PATHS <= paths


# ---------------------------------------------------------------
# Request validation (422 before any service or database runs)
# ---------------------------------------------------------------
def test_signup_with_missing_fields_is_422(client) -> None:
    assert client.post("/api/auth/signup", json={}).status_code == 422


def test_signup_with_invalid_email_is_422(client) -> None:
    body = {"email": "not-an-email", "password": "password123"}
    assert client.post("/api/auth/signup", json=body).status_code == 422


def test_signup_with_short_password_is_422(client) -> None:
    body = {"email": "ada@example.com", "password": "123"}
    assert client.post("/api/auth/signup", json=body).status_code == 422


def test_login_with_missing_password_is_422(client) -> None:
    body = {"email": "ada@example.com"}
    assert client.post("/api/auth/login", json=body).status_code == 422


# ---------------------------------------------------------------
# Signup
# ---------------------------------------------------------------
def test_signup_creates_user_and_profile(client, fake_supabase) -> None:
    body = {"email": "ada@example.com", "password": "password123", "full_name": "Ada Lovelace"}
    response = client.post("/api/auth/signup", json=body)

    assert response.status_code == 201
    data = response.json()
    assert data["user"]["email"] == "ada@example.com"
    assert data["access_token"] is not None

    # Profile row was created — and the password was NOT stored in it.
    profiles = fake_supabase.tables["profiles"]
    assert len(profiles) == 1
    assert profiles[0]["full_name"] == "Ada Lovelace"
    assert "password" not in profiles[0]


def test_signup_with_email_confirmation_has_no_token(client, fake_supabase) -> None:
    fake_supabase.auth.require_email_confirmation = True
    body = {"email": "ada@example.com", "password": "password123"}
    response = client.post("/api/auth/signup", json=body)

    assert response.status_code == 201
    assert response.json()["access_token"] is None
    assert "email" in response.json()["message"].lower()


def test_signup_with_existing_email_is_400(client, fake_supabase) -> None:
    create_user(fake_supabase, email="ada@example.com")
    body = {"email": "ada@example.com", "password": "password123"}
    assert client.post("/api/auth/signup", json=body).status_code == 400


# ---------------------------------------------------------------
# Login
# ---------------------------------------------------------------
def test_login_returns_access_token(client, fake_supabase) -> None:
    create_user(fake_supabase, email="ada@example.com")
    body = {"email": "ada@example.com", "password": "password123"}
    response = client.post("/api/auth/login", json=body)

    assert response.status_code == 200
    data = response.json()
    assert data["access_token"].startswith("token-")
    assert data["token_type"] == "bearer"
    assert data["user"]["email"] == "ada@example.com"


def test_login_with_wrong_password_is_401(client, fake_supabase) -> None:
    create_user(fake_supabase, email="ada@example.com")
    body = {"email": "ada@example.com", "password": "wrong-password"}
    assert client.post("/api/auth/login", json=body).status_code == 401


# ---------------------------------------------------------------
# /me
# ---------------------------------------------------------------
def test_me_requires_authentication(client) -> None:
    assert client.get("/api/auth/me").status_code == 401


def test_me_with_invalid_token_is_401(client) -> None:
    headers = {"Authorization": "Bearer not-a-real-token"}
    assert client.get("/api/auth/me", headers=headers).status_code == 401


def test_me_returns_user_and_profile(client) -> None:
    signup = client.post(
        "/api/auth/signup",
        json={"email": "ada@example.com", "password": "password123", "full_name": "Ada"},
    )
    headers = {"Authorization": f"Bearer {signup.json()['access_token']}"}
    response = client.get("/api/auth/me", headers=headers)

    assert response.status_code == 200
    data = response.json()
    assert data["user"]["email"] == "ada@example.com"
    assert data["profile"]["full_name"] == "Ada"


# ---------------------------------------------------------------
# Logout
# ---------------------------------------------------------------
def test_logout_revokes_token(client, fake_supabase) -> None:
    signup = client.post(
        "/api/auth/signup",
        json={"email": "ada@example.com", "password": "password123"},
    )
    token = signup.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    response = client.post("/api/auth/logout", headers=headers)

    assert response.status_code == 200
    assert response.json()["message"] == "Logged out successfully."
    assert token in fake_supabase.auth.signed_out


def test_logout_requires_authentication(client) -> None:
    assert client.post("/api/auth/logout").status_code == 401


def test_logout_with_invalid_token_is_401(client) -> None:
    headers = {"Authorization": "Bearer not-a-real-token"}
    assert client.post("/api/auth/logout", headers=headers).status_code == 401


# ---------------------------------------------------------------
# Response / request schemas
# ---------------------------------------------------------------
def test_session_response_defaults_to_bearer() -> None:
    session = SessionResponse(access_token="abc", user=AuthUser(id="u1", email="a@b.co"))
    assert session.token_type == "bearer"


def test_signup_request_requires_strong_password() -> None:
    with pytest.raises(ValidationError):
        SignupRequest(email="ada@example.com", password="short")
