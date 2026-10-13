"""Tests for the auth endpoints.

Everything runs against the fake Supabase client from conftest.py —
no real Supabase account or keys are required.
"""

from types import SimpleNamespace

import pytest
from pydantic import ValidationError
from supabase import AuthApiError, PostgrestAPIError

from app.main import app
from app.schemas.auth import (
    AuthUser,
    ForgotPasswordRequest,
    ResetPasswordRequest,
    SessionResponse,
    SignupRequest,
)
from app.services.auth_service import _session_response
from tests.conftest import create_user

AUTH_PATHS = {
    "/api/auth/signup",
    "/api/auth/login",
    "/api/auth/refresh",
    "/api/auth/me",
    "/api/auth/profile",
    "/api/auth/logout",
    "/api/auth/forgot-password",
    "/api/auth/reset-password",
}


def test_auth_routes_registered() -> None:
    """All auth routes must be present in the app."""
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


def test_signup_existing_email_with_confirmation_skips_profile_write(
    client, fake_supabase
) -> None:
    """An address that already exists must not trigger a profile insert.

    With email confirmation on, Supabase returns a fake user (random id, empty
    identities) for a known address. Writing a profile row for that id would
    violate the profiles -> auth.users foreign key.
    """
    fake_supabase.auth.require_email_confirmation = True
    body = {"email": "ada@example.com", "password": "password123", "full_name": "Ada"}

    first = client.post("/api/auth/signup", json=body)
    assert first.status_code == 201
    assert first.json()["access_token"] is None

    second = client.post("/api/auth/signup", json=body)
    assert second.status_code == 400
    assert "already exists" in second.json()["detail"].lower()

    # Only the real first signup wrote a profile — nothing for the fake id.
    assert len(fake_supabase.tables["profiles"]) == 1


def test_signup_profile_failure_is_not_blamed_on_the_schema(
    client, fake_supabase
) -> None:
    """A foreign-key (non-schema) profile error must not mention schema.sql."""
    fake_supabase.table_errors["profiles"] = PostgrestAPIError(
        {"message": "foreign key violation", "code": "23503", "details": "", "hint": ""}
    )
    body = {"email": "ada@example.com", "password": "password123"}
    response = client.post("/api/auth/signup", json=body)

    assert response.status_code == 500
    assert "schema.sql" not in response.json()["detail"]


def test_signup_profile_missing_table_points_at_the_schema(client, fake_supabase) -> None:
    """A genuinely missing table still tells the user to run schema.sql."""
    fake_supabase.table_errors["profiles"] = PostgrestAPIError(
        {
            "message": "Could not find the table 'public.profiles'",
            "code": "PGRST205",
            "details": "",
            "hint": "",
        }
    )
    body = {"email": "ada@example.com", "password": "password123"}
    response = client.post("/api/auth/signup", json=body)

    assert response.status_code == 500
    assert "schema.sql" in response.json()["detail"]


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
    assert data["refresh_token"] == "refresh-x"
    assert data["token_type"] == "bearer"
    assert data["user"]["email"] == "ada@example.com"


def test_login_with_wrong_password_is_401(client, fake_supabase) -> None:
    create_user(fake_supabase, email="ada@example.com")
    body = {"email": "ada@example.com", "password": "wrong-password"}
    assert client.post("/api/auth/login", json=body).status_code == 401


# ---------------------------------------------------------------
# Refresh
# ---------------------------------------------------------------
def test_refresh_returns_a_new_session(client, fake_supabase) -> None:
    user, _ = create_user(fake_supabase, email="ada@example.com")
    response = client.post("/api/auth/refresh", json={"refresh_token": "refresh-x"})

    assert response.status_code == 200
    data = response.json()
    assert data["access_token"] == f"token-{user.id}"
    assert data["refresh_token"] == "refresh-x"
    assert data["user"]["email"] == "ada@example.com"
    assert fake_supabase.auth.refreshed == ["refresh-x"]


def test_refresh_does_not_require_a_bearer_token(client, fake_supabase) -> None:
    """The refresh token is the only credential needed (no Authorization header)."""
    create_user(fake_supabase, email="ada@example.com")
    response = client.post("/api/auth/refresh", json={"refresh_token": "refresh-x"})
    assert response.status_code == 200


def test_refresh_with_invalid_token_is_401(client, fake_supabase) -> None:
    create_user(fake_supabase, email="ada@example.com")
    response = client.post("/api/auth/refresh", json={"refresh_token": "not-valid"})

    assert response.status_code == 401
    assert "expired" in response.json()["detail"].lower()


def test_refresh_when_supabase_rejects_is_401(client, fake_supabase) -> None:
    create_user(fake_supabase, email="ada@example.com")
    fake_supabase.auth.refresh_error = AuthApiError("Invalid Refresh Token", 400, None)

    assert client.post("/api/auth/refresh", json={"refresh_token": "refresh-x"}).status_code == 401


def test_refresh_with_missing_token_is_422(client) -> None:
    assert client.post("/api/auth/refresh", json={}).status_code == 422


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
# Update profile
# ---------------------------------------------------------------
def test_update_profile_requires_authentication(client) -> None:
    assert (
        client.put("/api/auth/profile", json={"full_name": "Ada"}).status_code == 401
    )


def test_update_profile_updates_full_name(client, fake_supabase) -> None:
    _, headers = create_user(fake_supabase, email="ada@example.com")
    response = client.put(
        "/api/auth/profile", headers=headers, json={"full_name": "Ada Lovelace"}
    )

    assert response.status_code == 200
    data = response.json()
    assert data["profile"]["full_name"] == "Ada Lovelace"

    # The change is persisted and visible through /me.
    rows = fake_supabase.tables["profiles"]
    assert rows and rows[0]["full_name"] == "Ada Lovelace"
    me = client.get("/api/auth/me", headers=headers).json()
    assert me["profile"]["full_name"] == "Ada Lovelace"


def test_update_profile_trims_whitespace(client, fake_supabase) -> None:
    _, headers = create_user(fake_supabase, email="ada@example.com")
    response = client.put(
        "/api/auth/profile", headers=headers, json={"full_name": "  Ada  "}
    )

    assert response.status_code == 200
    assert response.json()["profile"]["full_name"] == "Ada"


def test_update_profile_with_nothing_to_update_is_400(client, fake_supabase) -> None:
    _, headers = create_user(fake_supabase, email="ada@example.com")
    client.put(
        "/api/auth/profile", headers=headers, json={"full_name": "Ada"}
    )
    response = client.put(
        "/api/auth/profile", headers=headers, json={"full_name": "   "}
    )

    assert response.status_code == 400
    assert "nothing to update" in response.json()["detail"].lower()


def test_update_profile_creates_missing_profile_row(client, fake_supabase) -> None:
    """Editing a profile with no row yet (signup normally writes one) works."""
    _, headers = create_user(fake_supabase, email="ada@example.com")
    assert fake_supabase.tables.get("profiles", []) == []

    response = client.put(
        "/api/auth/profile", headers=headers, json={"full_name": "Ada"}
    )

    assert response.status_code == 200
    assert response.json()["profile"]["full_name"] == "Ada"
    assert fake_supabase.tables["profiles"][0]["full_name"] == "Ada"


def test_update_profile_missing_table_points_at_the_schema(client, fake_supabase) -> None:
    fake_supabase.table_errors["profiles"] = PostgrestAPIError(
        {
            "message": "Could not find the table 'public.profiles'",
            "code": "PGRST205",
            "details": "",
            "hint": "",
        }
    )
    _, headers = create_user(fake_supabase, email="ada@example.com")
    response = client.put(
        "/api/auth/profile", headers=headers, json={"full_name": "Ada"}
    )

    assert response.status_code == 500
    assert "schema.sql" in response.json()["detail"]


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
# Forgot password
# ---------------------------------------------------------------
def test_forgot_password_with_missing_email_is_422(client) -> None:
    assert client.post("/api/auth/forgot-password", json={}).status_code == 422


def test_forgot_password_with_invalid_email_is_422(client) -> None:
    response = client.post("/api/auth/forgot-password", json={"email": "not-an-email"})
    assert response.status_code == 422


def test_forgot_password_sends_link_to_reset_page(client, fake_supabase) -> None:
    create_user(fake_supabase, email="ada@example.com")
    response = client.post("/api/auth/forgot-password", json={"email": "ada@example.com"})

    assert response.status_code == 200
    assert "reset link" in response.json()["message"].lower()

    assert len(fake_supabase.auth.reset_emails) == 1
    sent = fake_supabase.auth.reset_emails[0]
    assert sent["email"] == "ada@example.com"
    # Redirect target comes from config and points at the reset page.
    assert sent["redirect_to"].endswith("/reset-password")


def test_forgot_password_does_not_reveal_account_existence(client, fake_supabase) -> None:
    """Unknown and known emails get the exact same response."""
    create_user(fake_supabase, email="ada@example.com")
    known = client.post("/api/auth/forgot-password", json={"email": "ada@example.com"})
    unknown = client.post("/api/auth/forgot-password", json={"email": "nobody@example.com"})

    assert known.status_code == unknown.status_code == 200
    assert known.json() == unknown.json()


def test_forgot_password_surfaces_mailer_rate_limit(client, fake_supabase) -> None:
    """Supabase's mailer rate limit is reported, not hidden as a fake success.

    Hitting the limit has nothing to do with whether the account exists, so
    telling the user to wait leaks nothing and avoids a silent no-op.
    """
    fake_supabase.auth.reset_error = AuthApiError(
        "email rate limit exceeded", 429, "over_email_send_rate_limit"
    )

    response = client.post("/api/auth/forgot-password", json={"email": "ada@example.com"})

    assert response.status_code == 429
    assert "wait" in response.json()["detail"].lower()
    assert fake_supabase.auth.reset_emails == []


def test_forgot_password_hides_other_send_errors(client, fake_supabase) -> None:
    """Non-rate-limit failures still return the generic success (no enum leak)."""
    fake_supabase.auth.reset_error = AuthApiError("smtp exploded", 500, "unexpected_failure")

    response = client.post("/api/auth/forgot-password", json={"email": "ada@example.com"})

    assert response.status_code == 200
    assert "reset link" in response.json()["message"].lower()


# ---------------------------------------------------------------
# Reset password
# ---------------------------------------------------------------
def test_reset_password_with_missing_fields_is_422(client) -> None:
    assert client.post("/api/auth/reset-password", json={}).status_code == 422


def test_reset_password_with_short_password_is_422(client, fake_supabase) -> None:
    user, _ = create_user(fake_supabase, email="ada@example.com")
    body = {"access_token": f"token-{user.id}", "new_password": "short"}
    assert client.post("/api/auth/reset-password", json=body).status_code == 422


def test_reset_password_with_invalid_token_is_401(client) -> None:
    body = {"access_token": "not-a-real-token", "new_password": "password456"}
    assert client.post("/api/auth/reset-password", json=body).status_code == 401


def test_reset_password_updates_password(client, fake_supabase) -> None:
    user, _ = create_user(fake_supabase, email="ada@example.com", password="password123")
    body = {
        "access_token": f"token-{user.id}",
        "refresh_token": "refresh-x",
        "new_password": "newpassword456",
    }
    response = client.post("/api/auth/reset-password", json=body)

    assert response.status_code == 200
    assert response.json()["message"] == "Your password has been reset successfully."

    # The new password works and the old one no longer does.
    assert (
        client.post(
            "/api/auth/login",
            json={"email": "ada@example.com", "password": "newpassword456"},
        ).status_code
        == 200
    )
    assert (
        client.post(
            "/api/auth/login",
            json={"email": "ada@example.com", "password": "password123"},
        ).status_code
        == 401
    )


def test_reset_password_does_not_store_password_in_tables(client, fake_supabase) -> None:
    user, _ = create_user(fake_supabase, email="ada@example.com")
    client.post(
        "/api/auth/reset-password",
        json={"access_token": f"token-{user.id}", "new_password": "newpassword456"},
    )
    for rows in fake_supabase.tables.values():
        for row in rows:
            assert "password" not in row


def test_reset_password_without_refresh_token_still_updates(client, fake_supabase) -> None:
    """A non-expired recovery access token is enough (refresh_token is optional)."""
    user, _ = create_user(fake_supabase, email="ada@example.com", password="password123")
    body = {"access_token": f"token-{user.id}", "new_password": "newpassword456"}

    assert client.post("/api/auth/reset-password", json=body).status_code == 200
    assert (
        client.post(
            "/api/auth/login", json={"email": "ada@example.com", "password": "newpassword456"}
        ).status_code
        == 200
    )


def test_reset_password_uses_the_supplied_recovery_session(client, fake_supabase) -> None:
    """The password is changed on a session built from the caller's token —
    i.e. Supabase itself decides which account (and only that account) is
    affected; the request body never names a user id."""
    user, _ = create_user(fake_supabase, email="ada@example.com")
    token = f"token-{user.id}"

    client.post(
        "/api/auth/reset-password",
        json={"access_token": token, "refresh_token": "refresh-x", "new_password": "newpassword456"},
    )

    assert fake_supabase.auth._session is not None
    assert fake_supabase.auth._session["access_token"] == token


def test_reset_password_when_supabase_rejects_update_is_400(client, fake_supabase) -> None:
    """A token that verifies but can no longer update (revoked/used) is a 400."""
    user, _ = create_user(fake_supabase, email="ada@example.com")
    fake_supabase.auth.update_error = AuthApiError("Token has expired or is invalid", 403, None)

    response = client.post(
        "/api/auth/reset-password",
        json={"access_token": f"token-{user.id}", "new_password": "newpassword456"},
    )

    assert response.status_code == 400
    assert "invalid or has expired" in response.json()["detail"].lower()


# ---------------------------------------------------------------
# Response / request schemas
# ---------------------------------------------------------------
def test_session_response_defaults_to_bearer() -> None:
    session = SessionResponse(access_token="abc", user=AuthUser(id="u1", email="a@b.co"))
    assert session.token_type == "bearer"


def test_session_response_helper_builds_from_supabase_result() -> None:
    """Regression: login/refresh build their reply through _session_response.

    That private helper was accidentally dropped while resolving a merge, so
    both endpoints raised `NameError: name '_session_response' is not defined`.
    Cover it directly to keep the helper from silently disappearing again.
    """
    result = SimpleNamespace(
        session=SimpleNamespace(
            access_token="token-1",
            refresh_token="refresh-1",
            token_type="bearer",
        ),
        user=SimpleNamespace(id="u1", email="a@b.co"),
    )

    response = _session_response(result)

    assert isinstance(response, SessionResponse)
    assert response.access_token == "token-1"
    assert response.refresh_token == "refresh-1"
    assert response.token_type == "bearer"
    assert response.user.id == "u1"
    assert response.user.email == "a@b.co"


def test_signup_request_requires_strong_password() -> None:
    with pytest.raises(ValidationError):
        SignupRequest(email="ada@example.com", password="short")


def test_forgot_password_request_requires_valid_email() -> None:
    with pytest.raises(ValidationError):
        ForgotPasswordRequest(email="not-an-email")


def test_reset_password_request_requires_strong_password_and_token() -> None:
    with pytest.raises(ValidationError):
        ResetPasswordRequest(access_token="x", new_password="short")
    with pytest.raises(ValidationError):
        ResetPasswordRequest(access_token="", new_password="password123")
