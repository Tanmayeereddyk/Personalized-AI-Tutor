"""CORS preflight tests.

Every cross-origin call the frontend makes (login, uploads, …)
starts with an OPTIONS preflight. Starlette's ``CORSMiddleware``
answers it directly — but only for origins listed in
``allow_origins``, which is derived from ``FRONTEND_URL``
(see ``app.core.config``). When ``FRONTEND_URL`` doesn't match
the origin the frontend is actually served from, the preflight
fails with a 400 ``Disallowed CORS origin`` — which is what
shows up in the backend log as ``OPTIONS /api/... 400 Bad
Request`` while the browser reports a CORS error.
"""

import pytest
from fastapi.testclient import TestClient

from app.core.config import Settings, settings
from app.main import app

# Clearly not a frontend origin: must never be granted access.
FOREIGN_ORIGIN = "http://evil.example.com"


def _preflight_headers(origin: str, method: str = "POST") -> dict[str, str]:
    """The headers a browser sends for a CORS preflight request."""
    return {
        "Origin": origin,
        "Access-Control-Request-Method": method,
        "Access-Control-Request-Headers": "content-type, authorization",
    }


@pytest.fixture()
def client() -> TestClient:
    return TestClient(app)


# ---------------------------------------------------------------
# Preflight against the running app
# ---------------------------------------------------------------
@pytest.mark.parametrize("origin", settings.cors_origins)
def test_preflight_succeeds_for_allowed_frontend_origin(
    client: TestClient, origin: str
) -> None:
    """The configured frontend origin may call the API (login as the example)."""
    response = client.options("/api/auth/login", headers=_preflight_headers(origin))

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == origin
    # allow_credentials=True in app.main — required for Bearer auth.
    assert response.headers["access-control-allow-credentials"] == "true"
    assert "content-type" in response.headers["access-control-allow-headers"]


def test_preflight_from_a_disallowed_origin_is_rejected(
    client: TestClient,
) -> None:
    """Origins outside FRONTEND_URL get no CORS headers (a 400, as browsers see it)."""
    response = client.options(
        "/api/auth/login",
        headers=_preflight_headers(FOREIGN_ORIGIN),
    )

    assert response.status_code == 400
    assert "disallowed cors origin" in response.text.lower()
    assert "access-control-allow-origin" not in response.headers


def test_preflight_rejects_a_disallowed_method(client: TestClient) -> None:
    """The middleware mirrors allow_methods=["*"], so POST preflights pass —
    but an origin that is not the frontend's is still rejected."""
    response = client.options(
        "/api/auth/login",
        headers=_preflight_headers(FOREIGN_ORIGIN, method="DELETE"),
    )

    assert response.status_code == 400
    assert "access-control-allow-origin" not in response.headers


# ---------------------------------------------------------------
# allow_origins derivation (app.core.config)
# ---------------------------------------------------------------
def _settings_with_frontend_url(url: str) -> Settings:
    """A Settings instance whose FRONTEND_URL is ``url``.

    ``Settings`` reads the environment once, at import time (the
    class attributes are already bound by then), so tests override
    the attribute directly instead of monkeypatching the environment.
    """
    cfg = Settings()
    cfg.FRONTEND_URL = url
    return cfg


def test_local_frontend_allows_both_loopback_names() -> None:
    """The dev server is reachable as localhost *and* 127.0.0.1."""
    cfg = _settings_with_frontend_url("http://localhost:8080")

    assert cfg.cors_origins == [
        "http://127.0.0.1:8080",
        "http://localhost:8080",
    ]


def test_127_frontend_url_also_allows_localhost() -> None:
    cfg = _settings_with_frontend_url("http://127.0.0.1:8080")

    assert cfg.cors_origins == [
        "http://127.0.0.1:8080",
        "http://localhost:8080",
    ]


def test_deployed_frontend_url_is_allowed_verbatim() -> None:
    """Production sets FRONTEND_URL to the deployed origin; only that one is allowed."""
    cfg = _settings_with_frontend_url("https://studyai.example.com")

    assert cfg.cors_origins == ["https://studyai.example.com"]
