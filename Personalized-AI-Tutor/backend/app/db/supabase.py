"""Supabase client configuration.

Two clients are created, both lazily (only when first used):

- Anonymous client  -> Supabase Auth operations (signup, login, token checks).
  Uses the anon key, which is safe for the frontend too — but we keep it
  on the server only.

- Service-role client -> database table reads/writes (profiles, courses).
  Uses the SERVICE ROLE key, which bypasses Row Level Security.
  This key must NEVER leave the server or appear in frontend code.

Secrets come from environment variables via app.core.config.
"""

from supabase import Client, create_client

from app.core.config import settings

_anon_client: Client | None = None
_service_client: Client | None = None


def get_supabase() -> Client:
    """Return the shared anonymous Supabase client (for Auth operations)."""
    global _anon_client
    if _anon_client is None:
        if not settings.SUPABASE_URL or not settings.SUPABASE_ANON_KEY:
            raise RuntimeError(
                "Supabase is not configured. Set SUPABASE_URL and "
                "SUPABASE_ANON_KEY in backend/.env (see .env.example)."
            )
        _anon_client = create_client(settings.SUPABASE_URL, settings.SUPABASE_ANON_KEY)
    return _anon_client


def get_service_client() -> Client:
    """Return the shared service-role Supabase client (for table access).

    Server-side only: this key bypasses RLS, so it must never be exposed
    to the frontend.
    """
    global _service_client
    if _service_client is None:
        if not settings.SUPABASE_URL or not settings.SUPABASE_SERVICE_ROLE_KEY:
            raise RuntimeError(
                "Supabase is not configured. Set SUPABASE_URL and "
                "SUPABASE_SERVICE_ROLE_KEY in backend/.env (see .env.example)."
            )
        _service_client = create_client(
            settings.SUPABASE_URL, settings.SUPABASE_SERVICE_ROLE_KEY
        )
    return _service_client
