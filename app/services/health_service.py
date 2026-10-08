"""Health-check logic.

Services hold the business logic so routes stay small.
Intentionally simple for now.
"""

from app.schemas.health import HealthResponse


def get_health() -> HealthResponse:
    """Return the current status of the backend."""
    return HealthResponse(status="healthy")
