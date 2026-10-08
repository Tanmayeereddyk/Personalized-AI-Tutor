"""Authentication logic (Supabase Auth).

Flow for every operation:
    Route -> this service -> Supabase client -> schema -> response

Rules followed here:
- Passwords are sent to Supabase Auth and never stored by our app.
- Profile rows are written with the service-role client (server-side only).
- Invalid/expired tokens become 401 responses.
"""

from fastapi import HTTPException
from supabase import AuthApiError, AuthError, Client, PostgrestAPIError

from app.schemas.auth import (
    AuthUser,
    LoginRequest,
    MeResponse,
    MessageResponse,
    ProfileResponse,
    SessionResponse,
    SignupRequest,
    SignupResponse,
)


def _auth_detail(exc: AuthError) -> str:
    """Extract a safe, user-friendly message from a Supabase auth error."""
    message = getattr(exc, "message", None)
    return str(message) if message else "Authentication failed"


def get_user_from_token(client: Client, token: str) -> AuthUser:
    """Validate an access token with Supabase and return the user.

    Raises 401 if the token is missing, invalid, or expired.
    """
    try:
        response = client.auth.get_user(jwt=token)
    except AuthError as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired token") from exc

    if response is None or response.user is None:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    return AuthUser(id=response.user.id, email=response.user.email)


def signup(anon_client: Client, admin_client: Client, payload: SignupRequest) -> SignupResponse:
    """Create a Supabase Auth user and their profile row.

    - The password goes to Supabase Auth only (never our own tables).
    - The profile row is created with the service-role client, because
      during signup the user may not have a session yet (email confirmation).
    """
    credentials: dict = {
        "email": payload.email,
        "password": payload.password,
    }
    if payload.full_name:
        # full_name is stored as Supabase user metadata (and copied to profiles).
        credentials["options"] = {"data": {"full_name": payload.full_name}}

    try:
        result = anon_client.auth.sign_up(credentials)
    except AuthError as exc:
        # e.g. "User already registered", "Password should be at least 6 characters"
        raise HTTPException(status_code=400, detail=_auth_detail(exc)) from exc

    if result.user is None:
        raise HTTPException(status_code=400, detail="Signup failed")

    user = AuthUser(id=result.user.id, email=result.user.email)

    # Create (or refresh) the matching profile record.
    try:
        admin_client.table("profiles").upsert(
            {
                "id": user.id,
                "email": user.email,
                "full_name": payload.full_name,
            }
        ).execute()
    except PostgrestAPIError as exc:
        raise HTTPException(
            status_code=500,
            detail="Could not create profile. Run database/schema.sql in Supabase first.",
        ) from exc

    # With email confirmation enabled Supabase returns no session yet.
    if result.session is None:
        return SignupResponse(
            message="Check your email to confirm your account.",
            user=user,
            access_token=None,
        )

    return SignupResponse(
        message="Signed up successfully.",
        user=user,
        access_token=result.session.access_token,
        token_type=result.session.token_type or "bearer",
    )


def login(anon_client: Client, payload: LoginRequest) -> SessionResponse:
    """Sign in with email/password and return an access token."""
    try:
        result = anon_client.auth.sign_in_with_password(
            {"email": payload.email, "password": payload.password}
        )
    except AuthError as exc:
        # Never reveal which part was wrong — same message for both.
        raise HTTPException(status_code=401, detail="Invalid email or password") from exc

    if result.session is None or result.user is None:
        raise HTTPException(status_code=401, detail="Invalid email or password")

    return SessionResponse(
        access_token=result.session.access_token,
        token_type=result.session.token_type or "bearer",
        user=AuthUser(id=result.user.id, email=result.user.email),
    )


def get_me(admin_client: Client, user: AuthUser) -> MeResponse:
    """Return the authenticated user plus their profiles row."""
    try:
        result = (
            admin_client.table("profiles")
            .select("*")
            .eq("id", user.id)
            .maybe_single()
            .execute()
        )
    except PostgrestAPIError as exc:
        raise HTTPException(
            status_code=500,
            detail="Could not load profile. Run database/schema.sql in Supabase first.",
        ) from exc

    data = getattr(result, "data", None)
    profile = ProfileResponse.model_validate(data) if data else None
    return MeResponse(user=user, profile=profile)


def logout(anon_client: Client, admin_client: Client, token: str) -> MessageResponse:
    """Validate the token, then revoke its refresh token at Supabase.

    Access tokens cannot be revoked until they expire (Supabase design),
    so the frontend should also discard the token.
    """
    get_user_from_token(anon_client, token)  # raises 401 for invalid tokens

    try:
        admin_client.auth.admin.sign_out(token, "global")
    except AuthApiError:
        # Token already expired/revoked — nothing left to do.
        pass

    return MessageResponse(message="Logged out successfully.")
