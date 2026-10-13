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
from app.core.config import settings
from app.schemas.auth import (
    AuthUser,
    ForgotPasswordRequest,
    LoginRequest,
    MeResponse,
    MessageResponse,
    ProfileResponse,
    RefreshRequest,
    ResetPasswordRequest,
    SessionResponse,
    SignupRequest,
    SignupResponse,
)


def _auth_detail(exc: AuthError) -> str:
    """Extract a safe, user-friendly message from a Supabase auth error."""
    message = getattr(exc, "message", None)
    return str(message) if message else "Authentication failed"


def _session_response(result) -> SessionResponse:
    """Build a SessionResponse (access + refresh token) from a Supabase result."""
    session = result.session
    user = result.user
    return SessionResponse(
        access_token=session.access_token,
        refresh_token=session.refresh_token,
        token_type=session.token_type or "bearer",
        user=AuthUser(id=user.id, email=user.email),
    )


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
    credentials["options"] = {
        "email_redirect_to": f"{settings.FRONTEND_URL.rstrip('/')}/login",
        "data": {"full_name": payload.full_name} if payload.full_name else {},
    }
    try:
        result = anon_client.auth.sign_up(credentials)
    except AuthError as exc:
        # e.g. "User already registered", "Password should be at least 6 characters"
        raise HTTPException(status_code=400, detail=_auth_detail(exc)) from exc

    if result.user is None:
        raise HTTPException(status_code=400, detail="Signup failed")

    # With email confirmation enabled, Supabase never reveals that an address
    # is already registered: instead of an error it returns a fake user with a
    # random id and an empty `identities` list. That id is not in auth.users,
    # so writing a profile row for it breaks the profiles -> auth.users foreign
    # key — which used to surface as a misleading "run schema.sql" message.
    identities = getattr(result.user, "identities", None)
    if identities is not None and len(identities) == 0:
        raise HTTPException(
            status_code=400,
            detail="An account with this email already exists. Please log in instead.",
        )

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
        # A missing table is the only failure that re-running the schema fixes;
        # anything else (e.g. a foreign-key violation) is not a schema problem.
        if getattr(exc, "code", None) in {"42P01", "PGRST205"}:
            raise HTTPException(
                status_code=500,
                detail="Could not create profile. Run database/schema.sql in Supabase first.",
            ) from exc
        raise HTTPException(
            status_code=500,
            detail="Could not create your profile. Please try again.",
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
        refresh_token=result.session.refresh_token,
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

    return _session_response(result)


def refresh(anon_client: Client, payload: RefreshRequest) -> SessionResponse:
    """Exchange a refresh token for a fresh session.

    Supabase rotates the refresh token on every exchange, so the caller must
    store the new one. A missing, invalid, or already-used token is a 401.
    """
    try:
        result = anon_client.auth.refresh_session(payload.refresh_token)
    except AuthError as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired session") from exc

    if result.session is None or result.user is None:
        raise HTTPException(status_code=401, detail="Invalid or expired session")

    return _session_response(result)


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


def request_password_reset(
    anon_client: Client, payload: ForgotPasswordRequest
) -> MessageResponse:
    """Email the user a password-reset link.

    The link points at the frontend's /reset-password page (redirect target
    comes from FRONTEND_URL, never a hardcoded domain). The same success
    message is returned whether or not the address has an account, so this
    endpoint cannot be used to enumerate users.

    The one exception is Supabase's mailer rate limit: it is independent of
    account existence, and reporting it lets the user know to retry later
    instead of waiting forever for an email that will never arrive.
    """
    redirect_to = f"{settings.FRONTEND_URL.rstrip('/')}/reset-password"
    try:
        anon_client.auth.reset_password_for_email(
            payload.email, {"redirect_to": redirect_to}
        )
    except AuthApiError as exc:
        if getattr(exc, "status", None) == 429 or getattr(exc, "code", None) == (
            "over_email_send_rate_limit"
        ):
            raise HTTPException(
                status_code=429,
                detail=(
                    "Too many reset emails have been requested recently. "
                    "Please wait a while and try again."
                ),
            ) from exc
        # Any other failure stays hidden, so this endpoint cannot be used to
        # discover which email addresses have accounts.
    except AuthError:
        pass

    return MessageResponse(
        message=(
            "If an account exists for this email address, "
            "you'll receive a password reset link shortly."
        )
    )


def reset_password(
    recovery_client: Client, verify_client: Client, payload: ResetPasswordRequest
) -> MessageResponse:
    """Set a new password for the user behind a recovery link.

    A password can only be changed with a valid recovery session: the
    access token from the emailed link is validated with Supabase first,
    then used to authenticate the password update. Tokens and passwords are
    never logged.
    """
    # 401 for missing, invalid or expired tokens.
    get_user_from_token(verify_client, payload.access_token)

    try:
        recovery_client.auth.set_session(
            payload.access_token, payload.refresh_token or ""
        )
        recovery_client.auth.update_user({"password": payload.new_password})
    except AuthError as exc:
        raise HTTPException(
            status_code=400,
            detail=(
                "This password reset link is invalid or has expired. "
                "Please request a new one."
            ),
        ) from exc

    return MessageResponse(message="Your password has been reset successfully.")
