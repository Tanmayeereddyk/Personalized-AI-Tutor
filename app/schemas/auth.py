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


class AuthUser(BaseModel):
    """The authenticated user (validated from a Bearer token)."""

    id: str
    email: str | None = None


class SessionResponse(BaseModel):
    """Returned by login: a Supabase access token plus the user."""

    access_token: str
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
