"""Tests for the root and health endpoints.

These tests run fully offline: no database, Supabase, or any
external service is required.
"""

from fastapi.testclient import TestClient

from app.main import app

# TestClient sends requests directly to the FastAPI app (no server needed).
client = TestClient(app)


def test_root_returns_200() -> None:
    """GET / should confirm that the backend is running."""
    response = client.get("/")

    assert response.status_code == 200
    assert response.json() == {"message": "StudyAI backend is running"}


def test_health_returns_200() -> None:
    """GET /health should return HTTP 200."""
    response = client.get("/health")

    assert response.status_code == 200


def test_health_returns_healthy_status() -> None:
    """GET /health should return {\"status\": \"healthy\"}."""
    response = client.get("/health")

    assert response.json() == {"status": "healthy"}
