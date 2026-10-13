"""RAG endpoints: indexing, chunk inspection, notes generation and tutoring.

All routes are auth-protected and ownership-checked (through the parent material
or course), so a user can only index, read, generate from, or ask about their own
content. Trying someone else's ids yields 404 — the same as a non-existent id.
"""

from fastapi import APIRouter, Depends, HTTPException, Response
from supabase import Client

from app.api.dependencies import get_current_user, get_service_supabase
from app.schemas.auth import AuthUser
from app.schemas.learning import NoteResponse
from app.schemas.rag import (
    ChunkResponse,
    IndexResult,
    IndexStatus,
    NotesGenerateRequest,
    TutorAnswerResponse,
    TutorAskRequest,
)
from app.services import (
    embeddings,
    extracted_unit_service,
    notes_pdf,
    notes_service,
    owned_service,
    rag_service,
    tutor_service,
)

router = APIRouter(tags=["rag"])


@router.post("/api/materials/{material_id}/index", response_model=IndexResult)
def index_material(
    material_id: str,
    user: AuthUser = Depends(get_current_user),
    db: Client = Depends(get_service_supabase),
) -> IndexResult:
    """Chunk, embed and store a material's extracted content for retrieval."""
    return IndexResult.model_validate(rag_service.index_material(db, user.id, material_id))


@router.get("/api/materials/{material_id}/index-status", response_model=IndexStatus)
def get_index_status(
    material_id: str,
    user: AuthUser = Depends(get_current_user),
    db: Client = Depends(get_service_supabase),
) -> IndexStatus:
    """How many chunks are indexed for this material (owner only).

    This is a status endpoint, so a missing RAG table is reported as
    ``indexed: false`` with an actionable ``message`` instead of a hard error.
    """
    units = extracted_unit_service.list_units(db, user.id, material_id)
    unit_count = len(rag_service.indexable_units(units))

    message: str | None = None
    try:
        count = rag_service.chunk_count(db, user.id, material_id)
    except rag_service.RagStoreUnavailable as exc:
        count = 0
        message = exc.detail

    return IndexStatus(
        material_id=material_id,
        chunk_count=count,
        indexed=count > 0,
        embedding_model=embeddings.embedding_model_name() if count else None,
        unit_count=unit_count,
        message=message,
    )


@router.get(
    "/api/materials/{material_id}/chunks",
    response_model=list[ChunkResponse],
)
def list_material_chunks(
    material_id: str,
    user: AuthUser = Depends(get_current_user),
    db: Client = Depends(get_service_supabase),
) -> list[ChunkResponse]:
    """The indexed chunks for one material, in source order."""
    rows = rag_service.list_chunks(db, user.id, material_id=material_id)
    return [
        ChunkResponse(
            id=row["id"],
            material_id=row["material_id"],
            course_id=row["course_id"],
            source_type=row["source_type"],
            chunk_order=row["chunk_order"],
            content=row["content"],
            page_number=row.get("page_number"),
            slide_number=row.get("slide_number"),
            start_timestamp_seconds=row.get("start_timestamp_seconds"),
            end_timestamp_seconds=row.get("end_timestamp_seconds"),
            extraction_method=row.get("extraction_method"),
        )
        for row in rows
    ]


@router.post(
    "/api/courses/{course_id}/notes/generate",
    response_model=NoteResponse,
    status_code=201,
)
def generate_notes(
    course_id: str,
    payload: NotesGenerateRequest,
    user: AuthUser = Depends(get_current_user),
    db: Client = Depends(get_service_supabase),
) -> NoteResponse:
    """Generate RAG-grounded notes for a material (or the whole course).

    Only indexed content is used; if nothing is indexed the request fails with a
    clear message rather than returning empty notes.
    """
    row = notes_service.generate_notes(
        db,
        user.id,
        course_id,
        material_id=payload.material_id,
        note_id=payload.note_id,
    )
    return NoteResponse.model_validate(row)


@router.get("/api/notes/{note_id}/pdf")
def download_note_pdf(
    note_id: str,
    user: AuthUser = Depends(get_current_user),
    db: Client = Depends(get_service_supabase),
) -> Response:
    """Render a saved note as a PDF (owner only).

    The Markdown in ``notes.content`` stays canonical, so the PDF always reflects
    the current notes. Streamed inline so the browser can display it; the same URL
    also works for a download.
    """
    note = owned_service.get_item(db, user.id, "notes", note_id)
    content = note.get("content") or ""
    if not content.strip():
        raise HTTPException(status_code=404, detail="This note has no content to render.")

    title = note.get("title") or "Notes"
    try:
        data = notes_pdf.render_note_pdf(title, content)
    except notes_pdf.PdfUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc

    filename = _pdf_filename(title)
    return Response(
        content=data,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


def _pdf_filename(title: str) -> str:
    """A safe ASCII download filename derived from the note title."""
    cleaned = "".join(
        char if char.isalnum() or char in " -_" else "" for char in title
    ).strip()
    cleaned = "-".join(cleaned.split()) or "notes"
    return f"{cleaned[:60]}.pdf"


@router.post(
    "/api/courses/{course_id}/tutor",
    response_model=TutorAnswerResponse,
)
def ask_tutor(
    course_id: str,
    payload: TutorAskRequest,
    user: AuthUser = Depends(get_current_user),
    db: Client = Depends(get_service_supabase),
) -> TutorAnswerResponse:
    """Answer a question as a personal tutor, grounded in the caller's content."""
    return TutorAnswerResponse.model_validate(
        tutor_service.answer(
            db,
            user.id,
            course_id,
            payload.question,
            material_id=payload.material_id,
            history=[turn.model_dump() for turn in payload.history],
        )
    )
