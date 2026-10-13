"""Schemas for authentication endpoints (signup, login, me, logout)."""

from pydantic import BaseModel, EmailStr, Field


class SignupRequest(BaseModel):
    """Body for POST /api/auth/signup.

    The password is sent to Supabase Auth — our application never
    stores passwords in the profiles table.
    """

    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    full_name: str | None = Field(default=None, max_length=200)


class LoginRequest(BaseModel):
    """Body for POST /api/auth/login."""

    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class RefreshRequest(BaseModel):
    """Body for POST /api/auth/refresh.

    The refresh token issued at login is exchanged for a fresh session, so a
    signed-in user can keep working past the short access-token expiry. It is
    the only credential needed — no Bearer token is required.
    """

    refresh_token: str = Field(min_length=1, max_length=4096)


class ForgotPasswordRequest(BaseModel):
    """Body for POST /api/auth/forgot-password.

    Only the email is needed. The endpoint always reports success so it
    can never be used to discover which addresses have an account.
    """

    email: EmailStr


class ResetPasswordRequest(BaseModel):
    """Body for POST /api/auth/reset-password.

    `access_token` (and `refresh_token`) come from the recovery link that
    Supabase emails; they prove the user actually followed that link. The
    new password follows the same rule as signup (at least 8 characters)
    and is sent straight to Supabase Auth, never stored by our app.
    """

    access_token: str = Field(min_length=1)
    refresh_token: str | None = Field(default=None, max_length=4096)
    new_password: str = Field(min_length=8, max_length=128)


class AuthUser(BaseModel):
    """The authenticated user (validated from a Bearer token)."""

    id: str
    email: str | None = None


class SessionResponse(BaseModel):
    """Returned by login and refresh: a Supabase access token plus the user."""

    access_token: str
    refresh_token: str | None = None
    token_type: str = "bearer"
    user: AuthUser


class SignupResponse(BaseModel):
    """Returned by signup.

    If Supabase email confirmation is enabled there is no session yet,
    so access_token is None and the user must confirm their email first.
    """

    message: str
    user: AuthUser
    access_token: str | None = None
    refresh_token: str | None = None
    token_type: str = "bearer"


class ProfileResponse(BaseModel):
    """A row from the profiles table."""

    id: str
    email: str | None = None
    full_name: str | None = None
    created_at: str | None = None
    updated_at: str | None = None


class MeResponse(BaseModel):
    """Returned by GET /api/auth/me: auth user + their profile row."""

    user: AuthUser
    profile: ProfileResponse | None = None


class MessageResponse(BaseModel):
    """Simple message body (used by logout)."""

    message: str
