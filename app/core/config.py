"""Application configuration.

All settings are read from environment variables so nothing is
hardcoded throughout the app. Values live in the .env file
(see .env.example for the expected variables).
"""

import os
from pathlib import Path

from dotenv import load_dotenv

# Load the .env file located in the backend/ folder.
BACKEND_DIR = Path(__file__).resolve().parents[2]  # backend/
load_dotenv(BACKEND_DIR / ".env")


class Settings:
    """Application settings loaded from environment variables."""

    APP_NAME: str = os.getenv("APP_NAME", "StudyAI Backend")
    APP_ENV: str = os.getenv("APP_ENV", "development")
    FRONTEND_URL: str = os.getenv("FRONTEND_URL", "http://localhost:8080")

    # Supabase (never hardcode keys — they live in .env, which Git ignores)
    SUPABASE_URL: str = os.getenv("SUPABASE_URL", "")
    SUPABASE_ANON_KEY: str = os.getenv("SUPABASE_ANON_KEY", "")
    SUPABASE_SERVICE_ROLE_KEY: str = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "")

    @property
    def cors_origins(self) -> list[str]:
        """Origins allowed by CORS: the configured frontend URL,
        plus its localhost / 127.0.0.1 variant (both open the same app)."""
        origins: set[str] = {self.FRONTEND_URL}
        if "localhost" in self.FRONTEND_URL:
            origins.add(self.FRONTEND_URL.replace("localhost", "127.0.0.1"))
        elif "127.0.0.1" in self.FRONTEND_URL:
            origins.add(self.FRONTEND_URL.replace("127.0.0.1", "localhost"))
        return sorted(origins)


# Single settings object used everywhere: from app.core.config import settings
settings = Settings()
