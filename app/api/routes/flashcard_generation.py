from fastapi import APIRouter, Depends
from supabase import Client
from app.api.dependencies import get_current_user, get_service_supabase
from app.schemas.auth import AuthUser
from app.schemas.flashcards import FlashcardGenerateRequest, FlashcardGenerateResponse
from app.services import flashcard_service

router = APIRouter(tags=["flashcard-generation"])

@router.post("/api/courses/{course_id}/flashcard-decks/generate", response_model=FlashcardGenerateResponse)
def generate(course_id: str, payload: FlashcardGenerateRequest, user: AuthUser = Depends(get_current_user), db: Client = Depends(get_service_supabase)):
    return flashcard_service.generate_deck(db, user.id, course_id, **payload.model_dump())
