"""Health endpoint.

Routes only handle HTTP: they call a service and return its result.
No business logic belongs here.
"""

from fastapi import APIRouter

from app.schemas.health import HealthResponse
from app.services import health_service

# All routes in this file are registered under this router.
router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
def get_health() -> HealthResponse:
    """Check that the backend is running."""
    return health_service.get_health()
