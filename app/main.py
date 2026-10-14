"""FastAPI application entry point.

Responsibilities (and nothing more):
- create the FastAPI application
- configure CORS
- register API routers

Business logic lives in services/, not here.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes import (
    auth,
    courses,
    extraction,
    health,
    learning,
    materials,
    rag,
    topics,
)
from app.core.config import settings

import logging

# Show the app's own INFO logs (LLM call timings, notes/tutor timings) in the
# server console alongside uvicorn's. Does nothing if logging is already set up.
logging.basicConfig(
    level=logging.INFO,
    format="%(levelname)s:     %(message)s",
    force=False,
)

# Create the application. Interactive docs are served at /docs.
app = FastAPI(
    title=settings.APP_NAME,
    description="Backend for StudyAI, an AI-powered study assistant.",
    version="0.1.0",
)

# CORS: let the frontend (FRONTEND_URL in .env) call this API.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register feature routers here.
app.include_router(health.router)
app.include_router(auth.router)
app.include_router(courses.router)
app.include_router(materials.router)
app.include_router(extraction.router)
app.include_router(rag.router)
app.include_router(learning.notes_router)
app.include_router(learning.quizzes_router)
app.include_router(learning.decks_router)
app.include_router(learning.events_router)
app.include_router(learning.bookmarks_router)
app.include_router(learning.flashcards_router)
app.include_router(topics.router)


@app.get("/", tags=["root"])
def read_root() -> dict[str, str]:
    """Simple endpoint to confirm the backend is running."""
    return {"message": "StudyAI backend is running"}
