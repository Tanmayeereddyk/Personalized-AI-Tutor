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

    # ------------------------------------------------------------------
    # RAG: embeddings (local — never an LLM key, never an external API)
    # ------------------------------------------------------------------
    # "hashing" is a fully local, dependency-light embedder that needs no
    # download and no network. If sentence-transformers is installed, set
    # EMBEDDING_BACKEND=sentence-transformers to use a real local model.
    EMBEDDING_BACKEND: str = os.getenv("EMBEDDING_BACKEND", "hashing")
    EMBEDDING_MODEL: str = os.getenv("EMBEDDING_MODEL", "hashing-512")
    EMBEDDING_DIM: int = int(os.getenv("EMBEDDING_DIM", "512"))
    SENTENCE_TRANSFORMERS_MODEL: str = os.getenv(
        "SENTENCE_TRANSFORMERS_MODEL", "sentence-transformers/all-MiniLM-L6-v2"
    )

    # Chunking / retrieval knobs.
    RAG_CHUNK_CHARS: int = int(os.getenv("RAG_CHUNK_CHARS", "900"))
    RAG_CHUNK_OVERLAP_CHARS: int = int(os.getenv("RAG_CHUNK_OVERLAP_CHARS", "150"))
    RAG_TOP_K: int = int(os.getenv("RAG_TOP_K", "8"))
    RAG_MIN_SCORE: float = float(os.getenv("RAG_MIN_SCORE", "0.05"))
    RAG_NOTES_BATCH_CHUNKS: int = int(os.getenv("RAG_NOTES_BATCH_CHUNKS", "12"))
    # Topics (knowledge map): how much indexed content is offered to the model
    # in one call, and the most topics it may return for a course.
    RAG_TOPICS_MAX_SOURCE_CHARS: int = int(os.getenv("RAG_TOPICS_MAX_SOURCE_CHARS", "12000"))
    RAG_TOPICS_MAX: int = int(os.getenv("RAG_TOPICS_MAX", "12"))

    # ------------------------------------------------------------------
    # LLM (required for notes generation and the tutor). Any OpenAI-compatible
    # ``/chat/completions`` endpoint works: Google Gemini, OpenAI, OpenRouter,
    # Groq, Together, or a local Ollama server.
    #
    # The key is read from ``LLM_API_KEY`` or, as a fallback, ``GEMINI_API_KEY``
    # (Google AI Studio), so an existing Gemini key is picked up without
    # duplicating it. The Gemini key is used against Google's OpenAI-compatible
    # endpoint, which needs no extra dependency.
    # ------------------------------------------------------------------
    LLM_PROVIDER: str = os.getenv("LLM_PROVIDER", "openai")
    LLM_API_KEY: str = os.getenv("LLM_API_KEY", "")
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "")
    LLM_MODEL: str = os.getenv("LLM_MODEL", "")
    # An explicit base URL wins; otherwise it is derived from the provider.
    LLM_BASE_URL: str = os.getenv("LLM_BASE_URL", "")
    LLM_TIMEOUT_SECONDS: int = int(os.getenv("LLM_TIMEOUT_SECONDS", "120"))
    # Notes are generated in batches; these run in parallel so a long document
    # finishes in roughly one batch's time instead of the sum of every batch.
    # Keep it modest: the provider rate-limits bursts of requests.
    LLM_MAX_CONCURRENCY: int = int(os.getenv("LLM_MAX_CONCURRENCY", "4"))
    # Size of the shared, keep-alive HTTP connection pool to the provider.
    LLM_MAX_CONNECTIONS: int = int(os.getenv("LLM_MAX_CONNECTIONS", "16"))
    # Transient provider errors (HTTP 429, 5xx, timeouts) are retried this many
    # times per model, then the next model in LLM_FALLBACK_MODELS is tried.
    LLM_MAX_ATTEMPTS: int = int(os.getenv("LLM_MAX_ATTEMPTS", "2"))
    LLM_RETRY_BACKOFF_SECONDS: float = float(os.getenv("LLM_RETRY_BACKOFF_SECONDS", "0.8"))
    # Comma-separated backup models, tried in order when the primary model is
    # overloaded or rate-limited (Google return 503 "high demand" fairly often).
    LLM_FALLBACK_MODELS: str = os.getenv("LLM_FALLBACK_MODELS", "")
    # Which engine notes generation uses. Only "llm" is supported: there is no
    # silent extractive fallback, so a missing key surfaces as a clear error.
    NOTES_GENERATION_PROVIDER: str = os.getenv("NOTES_GENERATION_PROVIDER", "llm")

    # OpenAI-compatible base URLs for the providers we know about.
    _PROVIDER_BASE_URLS: dict[str, str] = {
        "gemini": "https://generativelanguage.googleapis.com/v1beta/openai",
        "google": "https://generativelanguage.googleapis.com/v1beta/openai",
        "openai": "https://api.openai.com/v1",
        "openrouter": "https://openrouter.ai/api/v1",
        "groq": "https://api.groq.com/openai/v1",
        "ollama": "http://localhost:11434/v1",
    }

    @property
    def llm_api_key(self) -> str:
        """The configured key, accepting ``LLM_API_KEY`` or ``GEMINI_API_KEY``."""
        return self.LLM_API_KEY or self.GEMINI_API_KEY

    @property
    def llm_base_url(self) -> str:
        """The OpenAI-compatible base URL, derived from the provider when unset."""
        if self.LLM_BASE_URL.strip():
            return self.LLM_BASE_URL.strip()
        return self._PROVIDER_BASE_URLS.get(
            self.LLM_PROVIDER.strip().lower(), self._PROVIDER_BASE_URLS["openai"]
        )

    @property
    def llm_configured(self) -> bool:
        """True only when a key *and* a model are set."""
        return bool(self.llm_api_key and self.LLM_MODEL)

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
