"""Shared FastAPI dependencies.

Routes use these so that:

- Supabase clients are created in one place (app/db/supabase.py),
- authentication is checked in one place (get_current_user),
- tests can swap in a fake Supabase client with dependency overrides.
"""

from fastapi import Depends, Header, HTTPException
from supabase import Client

from app.db import supabase as supabase_db
from app.schemas.auth import AuthUser
from app.services import auth_service


def get_supabase() -> Client:
    """Anonymous Supabase client (Auth operations)."""
    return supabase_db.get_supabase()


def get_service_supabase() -> Client:
    """Service-role Supabase client (table access, server-side only)."""
    return supabase_db.get_service_client()


def get_recovery_supabase() -> Client:
    """A dedicated anonymous client for password recovery.

    Recovery temporarily sets a session on the client, so it must not be the
    shared client used by the rest of the app. Kept as a dependency so tests
    can swap in the fake Supabase client.
    """
    return supabase_db.create_anon_client()


def get_access_token(authorization: str | None = Header(default=None)) -> str:
    """Extract the JWT from `Authorization: Bearer <token>`.

    Missing or malformed headers return 401 immediately.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=401,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        raise HTTPException(
            status_code=401,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return token


def get_current_user(
    token: str = Depends(get_access_token),
    client: Client = Depends(get_supabase),
) -> AuthUser:
    """Validate the Bearer token with Supabase and return the user.

    Invalid/expired tokens return 401.
    """
    return auth_service.get_user_from_token(client, token)
