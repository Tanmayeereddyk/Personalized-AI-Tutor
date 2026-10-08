"""Authentication endpoints (signup, login, me, logout).

Routes only handle HTTP: parse the request, call a service, return
a schema. Business logic lives in app/services/auth_service.py.
"""

from fastapi import APIRouter, Depends
from supabase import Client

from app.api.dependencies import (
    get_access_token,
    get_current_user,
    get_service_supabase,
    get_supabase,
)
from app.schemas.auth import (
    AuthUser,
    LoginRequest,
    MeResponse,
    MessageResponse,
    SessionResponse,
    SignupRequest,
    SignupResponse,
)
from app.services import auth_service

router = APIRouter(tags=["auth"])


@router.post("/api/auth/signup", response_model=SignupResponse, status_code=201)
def signup(
    payload: SignupRequest,
    anon_client: Client = Depends(get_supabase),
    admin_client: Client = Depends(get_service_supabase),
) -> SignupResponse:
    """Create a new account (email + password, optional full name)."""
    return auth_service.signup(anon_client, admin_client, payload)


@router.post("/api/auth/login", response_model=SessionResponse)
def login(
    payload: LoginRequest,
    anon_client: Client = Depends(get_supabase),
) -> SessionResponse:
    """Sign in and receive an access token."""
    return auth_service.login(anon_client, payload)


@router.get("/api/auth/me", response_model=MeResponse)
def me(
    user: AuthUser = Depends(get_current_user),
    admin_client: Client = Depends(get_service_supabase),
) -> MeResponse:
    """Return the logged-in user and their profile (requires Bearer token)."""
    return auth_service.get_me(admin_client, user)


@router.post("/api/auth/logout", response_model=MessageResponse)
def logout(
    token: str = Depends(get_access_token),
    anon_client: Client = Depends(get_supabase),
    admin_client: Client = Depends(get_service_supabase),
) -> MessageResponse:
    """Validate the token, then revoke it at Supabase (401 if invalid)."""
    return auth_service.logout(anon_client, admin_client, token)
