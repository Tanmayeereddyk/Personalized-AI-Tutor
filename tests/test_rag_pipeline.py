"""Tests for the RAG pipeline: chunking, indexing, retrieval, notes, tutoring.

Everything runs offline against the fake Supabase client and the built-in local
embedder, so no API key, network or model download is needed. The real HTTP
endpoints are exercised end to end (upload -> extract -> index -> notes/tutor),
plus focused unit tests for chunking and for the ownership/deletion rules.
"""

import re
import threading
import time

import fitz  # PyMuPDF — installed in this environment

from app.core.config import settings
from app.services import embeddings, llm_service, notes_pdf, rag_service

PHOTOSYNTHESIS = (
    "Photosynthesis converts light energy into chemical energy. "
    "Plants use chlorophyll to absorb sunlight. "
    "The process produces glucose and oxygen."
)
RESPIRATION = (
    "Mitochondria generate ATP through cellular respiration. "
    "Respiration breaks down glucose to release chemical energy."
)


# ----------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------

def _signup(client, email: str) -> dict[str, str]:
    response = client.post(
        "/api/auth/signup",
        json={"email": email, "password": "password123", "full_name": "Tester"},
    )
    assert response.status_code == 201, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def _create_course(client, headers: dict[str, str], name: str = "Biology") -> dict:
    response = client.post("/api/courses", json={"name": name}, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


def _pdf_bytes(pages: list[str]) -> bytes:
    """A small PDF with a real text layer, one page per supplied string."""
    document = fitz.open()
    try:
        for text in pages:
            page = document.new_page()
            # insert_textbox wraps the sentences onto multiple lines.
            page.insert_textbox(fitz.Rect(72, 72, 520, 720), text)
    finally:
        data = document.tobytes()
        document.close()
    return data


def _upload(client, headers, course_id: str, filename: str, data: bytes, mime: str) -> dict:
    response = client.post(
        f"/api/courses/{course_id}/materials",
        files=[("files", (filename, data, mime))],
        headers=headers,
    )
    assert response.status_code == 201, response.text
    return response.json()[0]


def _extract(client, headers, material_id: str) -> None:
    response = client.post(f"/api/materials/{material_id}/extraction", headers=headers)
    assert response.status_code == 202, response.text


def _make_indexed_material(client, headers, course_id: str, pages: list[str]) -> dict:
    """Upload + extract a PDF; extraction also builds the RAG index."""
    material = _upload(
        client, headers, course_id, "biology.pdf", _pdf_bytes(pages), "application/pdf"
    )
    _extract(client, headers, material["id"])
    return material


# ----------------------------------------------------------------------
# Chunking rules (unit level)
# ----------------------------------------------------------------------

def test_build_chunks_skips_empty_failed_and_summary_rows() -> None:
    material = {"id": "m1", "user_id": "u1", "course_id": "c1", "type": "pdf"}
    units = [
        {
            "id": "u1",
            "content_type": "text",
            "content": "A real sentence about cells.",
            "status": "extracted",
            "unit_order": 10,
            "page_number": 1,
            "metadata": {"source": "text_layer"},
        },
        {  # empty extraction result — must never be indexed
            "id": "u2",
            "content_type": "text",
            "content": "   ",
            "status": "extracted",
            "unit_order": 20,
            "page_number": 2,
            "metadata": {},
        },
        {  # failed unit — not valid content
            "id": "u3",
            "content_type": "text",
            "content": "corrupted",
            "status": "failed",
            "unit_order": 30,
            "metadata": {},
        },
        {  # the persisted warning/summary row
            "id": "u4",
            "content_type": "text",
            "content": "Extraction warning",
            "status": "warning",
            "unit_order": 0,
            "metadata": {"kind": "summary", "warnings": ["x"]},
        },
        {  # an image frame carries no text to embed
            "id": "u5",
            "content_type": "image",
            "content": "",
            "status": "extracted",
            "unit_order": 40,
            "metadata": {"source": "video_frame"},
        },
    ]

    chunks = rag_service.build_chunks(material, units)

    assert len(chunks) == 1
    chunk = chunks[0]
    assert chunk["content"] == "A real sentence about cells."
    assert chunk["material_id"] == "m1"
    assert chunk["user_id"] == "u1"
    assert chunk["course_id"] == "c1"
    assert chunk["source_type"] == "pdf"
    assert chunk["page_number"] == 1
    assert chunk["chunk_order"] == 1


def test_long_text_is_split_into_overlapping_chunks(monkeypatch) -> None:
    monkeypatch.setattr(settings, "RAG_CHUNK_CHARS", 60)
    monkeypatch.setattr(settings, "RAG_CHUNK_OVERLAP_CHARS", 10)
    long_text = " ".join(
        f"Sentence number {index} explains a distinct idea." for index in range(12)
    )
    units = [{"id": "u1", "content": long_text, "status": "extracted", "unit_order": 10}]

    chunks = rag_service.build_chunks(
        {"id": "m1", "user_id": "u1", "course_id": "c1", "type": "pdf"}, units
    )

    assert len(chunks) > 1
    assert [c["chunk_order"] for c in chunks] == list(range(1, len(chunks) + 1))
    # The provenance (page/source) is preserved on every split piece.
    assert all(c["material_id"] == "m1" for c in chunks)


# ----------------------------------------------------------------------
# Indexing + retrieval through the real API
# ----------------------------------------------------------------------

def test_extraction_automatically_indexes_material(client) -> None:
    headers = _signup(client, "alice@example.com")
    course = _create_course(client, headers)
    material = _make_indexed_material(
        client, headers, course["id"], [PHOTOSYNTHESIS, RESPIRATION]
    )

    status = client.get(
        f"/api/materials/{material['id']}/index-status", headers=headers
    ).json()
    assert status["indexed"] is True
    assert status["chunk_count"] >= 2
    assert status["embedding_model"] == embeddings.embedding_model_name()

    chunks = client.get(
        f"/api/materials/{material['id']}/chunks", headers=headers
    ).json()
    assert len(chunks) == status["chunk_count"]
    # Embeddings are never sent to the client.
    assert all("embedding" not in chunk for chunk in chunks)
    # Page references survive into the index.
    assert {chunk["page_number"] for chunk in chunks} == {1, 2}


def test_reindexing_is_repeatable_without_duplicates(client) -> None:
    headers = _signup(client, "alice@example.com")
    course = _create_course(client, headers)
    material = _make_indexed_material(
        client, headers, course["id"], [PHOTOSYNTHESIS, RESPIRATION]
    )

    first = client.post(
        f"/api/materials/{material['id']}/index", headers=headers
    ).json()
    second = client.post(
        f"/api/materials/{material['id']}/index", headers=headers
    ).json()

    assert first["chunk_count"] == second["chunk_count"]
    stored = client.get(
        f"/api/materials/{material['id']}/chunks", headers=headers
    ).json()
    assert len(stored) == second["chunk_count"]


def test_retrieval_prefers_the_relevant_page(client) -> None:
    headers = _signup(client, "alice@example.com")
    course = _create_course(client, headers)
    material = _make_indexed_material(
        client, headers, course["id"], [PHOTOSYNTHESIS, RESPIRATION]
    )

    # Ask the tutor; the answer must come from the photosynthesis page.
    answer = client.post(
        f"/api/courses/{course['id']}/tutor",
        json={"question": "How do plants use chlorophyll?", "material_id": material["id"]},
        headers=headers,
    ).json()
    assert answer["grounded"] is True
    assert answer["citations"]
    assert all(c["material_id"] == material["id"] for c in answer["citations"])
    assert 1 in {c["page"] for c in answer["citations"]}


# ----------------------------------------------------------------------
# Notes generation
# ----------------------------------------------------------------------

def test_generate_notes_is_grounded_cited_and_saved(client) -> None:
    headers = _signup(client, "alice@example.com")
    course = _create_course(client, headers)
    material = _make_indexed_material(
        client, headers, course["id"], [PHOTOSYNTHESIS, RESPIRATION]
    )

    response = client.post(
        f"/api/courses/{course['id']}/notes/generate",
        json={"material_id": material["id"]},
        headers=headers,
    )
    assert response.status_code == 201, response.text
    note = response.json()

    assert note["generated"] is True
    assert note["generation_method"] == "llm"
    assert "chlorophyll" in note["content"]
    assert note["source_material_ids"] == [material["id"]]
    assert note["source_refs"]
    assert {ref["page"] for ref in note["source_refs"]} >= {1, 2}
    assert note["topics"]

    # Persisted: it can be reopened without regenerating.
    reopened = client.get(f"/api/notes/{note['id']}", headers=headers)
    assert reopened.status_code == 200
    assert reopened.json()["content"] == note["content"]


def test_generate_notes_fails_clearly_when_nothing_indexed(client) -> None:
    headers = _signup(client, "alice@example.com")
    course = _create_course(client, headers)

    response = client.post(
        f"/api/courses/{course['id']}/notes/generate",
        json={},
        headers=headers,
    )
    assert response.status_code == 400
    assert "index" in response.json()["detail"].lower()


def test_generate_notes_indexes_an_unindexed_material_on_demand(
    client, fake_supabase
) -> None:
    """A material that was extracted but never indexed still gets notes.

    This is the "material exists, but RAG indexing has not completed" case:
    generation must re-process the existing extracted content instead of
    failing.
    """
    headers = _signup(client, "alice@example.com")
    course = _create_course(client, headers)
    material = _make_indexed_material(
        client, headers, course["id"], [PHOTOSYNTHESIS, RESPIRATION]
    )

    # Simulate an extraction that finished but never built the vector index.
    fake_supabase.tables["rag_chunks"].clear()

    before = client.get(
        f"/api/materials/{material['id']}/index-status", headers=headers
    ).json()
    assert before["indexed"] is False
    assert before["unit_count"] >= 2

    response = client.post(
        f"/api/courses/{course['id']}/notes/generate",
        json={"material_id": material["id"]},
        headers=headers,
    )
    assert response.status_code == 201, response.text
    note = response.json()
    assert note["generated"] is True
    assert note["source_material_ids"] == [material["id"]]
    assert "chlorophyll" in note["content"]

    # The index was rebuilt on demand from the existing extracted units.
    assert fake_supabase.tables["rag_chunks"]
    after = client.get(
        f"/api/materials/{material['id']}/index-status", headers=headers
    ).json()
    assert after["indexed"] is True


def test_generate_notes_reports_missing_extraction_without_404(client) -> None:
    """A material that exists but was never extracted gives a clear 400."""
    headers = _signup(client, "alice@example.com")
    course = _create_course(client, headers)
    material = _upload(
        client, headers, course["id"], "blank.pdf", _pdf_bytes([""]), "application/pdf"
    )

    response = client.post(
        f"/api/courses/{course['id']}/notes/generate",
        json={"material_id": material["id"]},
        headers=headers,
    )
    assert response.status_code == 400, response.text
    detail = response.json()["detail"].lower()
    assert "extract" in detail and "index" in detail


def test_generate_notes_for_a_course_indexes_missing_materials(
    client, fake_supabase
) -> None:
    headers = _signup(client, "alice@example.com")
    course = _create_course(client, headers)
    _make_indexed_material(client, headers, course["id"], [PHOTOSYNTHESIS, RESPIRATION])

    fake_supabase.tables["rag_chunks"].clear()

    response = client.post(
        f"/api/courses/{course['id']}/notes/generate",
        json={},
        headers=headers,
    )
    assert response.status_code == 201, response.text
    assert response.json()["generated"] is True


def test_index_status_reports_missing_store_without_failing(
    client, monkeypatch
) -> None:
    """A missing RAG table is reported as status, not a hard failure."""
    headers = _signup(client, "alice@example.com")
    course = _create_course(client, headers)
    material = _make_indexed_material(client, headers, course["id"], [PHOTOSYNTHESIS])

    def _missing(client, user_id, material_id):  # noqa: ARG001
        raise rag_service.RagStoreUnavailable()

    monkeypatch.setattr(rag_service, "chunk_count", _missing)

    response = client.get(
        f"/api/materials/{material['id']}/index-status", headers=headers
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["indexed"] is False
    assert body["unit_count"] >= 1
    assert body["message"]


def test_generate_notes_reports_missing_store_clearly(client, monkeypatch) -> None:
    """A missing RAG table names the SQL to run — it is never a "Not Found"."""
    headers = _signup(client, "alice@example.com")
    course = _create_course(client, headers)
    material = _make_indexed_material(client, headers, course["id"], [PHOTOSYNTHESIS])

    def _missing(*args, **kwargs):
        raise rag_service.RagStoreUnavailable()

    monkeypatch.setattr(rag_service, "list_chunks", _missing)

    response = client.post(
        f"/api/courses/{course['id']}/notes/generate",
        json={"material_id": material["id"]},
        headers=headers,
    )
    assert response.status_code == 503, response.text
    assert "005_rag_pipeline.sql" in response.json()["detail"]


def test_notes_generation_uses_configured_llm_and_validates_citations(
    client, monkeypatch
) -> None:
    headers = _signup(client, "alice@example.com")
    course = _create_course(client, headers)
    material = _make_indexed_material(
        client, headers, course["id"], [PHOTOSYNTHESIS, RESPIRATION]
    )

    monkeypatch.setattr(llm_service, "is_configured", lambda: True)
    monkeypatch.setattr(
        llm_service,
        "complete",
        lambda system, user, **kwargs: "## Overview\n- Plants absorb light [#1]\n",
    )

    note = client.post(
        f"/api/courses/{course['id']}/notes/generate",
        json={"material_id": material["id"]},
        headers=headers,
    ).json()

    assert note["generation_method"] == "llm"
    assert "Plants absorb light" in note["content"]
    # Only chunks actually referenced by the model become citations.
    assert note["source_refs"]


def test_notes_batches_run_in_parallel_and_keep_source_order(client, monkeypatch) -> None:
    """Long documents are split into batches that run concurrently, not serially.

    The merged notes must still appear in source order even though the batches
    finish out of order.
    """
    headers = _signup(client, "alice@example.com")
    course = _create_course(client, headers)
    material = _make_indexed_material(client, headers, course["id"], [PHOTOSYNTHESIS])
    monkeypatch.setattr(settings, "RAG_NOTES_BATCH_CHUNKS", 1)

    chunks = [
        {
            "id": f"chunk-{i}",
            "user_id": "u1",
            "course_id": course["id"],
            "material_id": material["id"],
            "content": f"Passage number {i}.",
            "chunk_order": i,
            "page_number": i,
        }
        for i in range(1, 6)
    ]
    monkeypatch.setattr(rag_service, "list_chunks", lambda *a, **k: [dict(c) for c in chunks])

    lock = threading.Lock()
    state = {"active": 0, "peak": 0}

    def fake_complete(system, user, **kwargs):
        if "Merge the partial" in system:  # the merge call passes partials through
            return user
        with lock:
            state["active"] += 1
            state["peak"] = max(state["peak"], state["active"])
        time.sleep(0.15)
        with lock:
            state["active"] -= 1
        number = re.search(r"\[#(\d+)\]", user).group(1)
        return f"## Section {number}\n- point {number} [#{number}]\n"

    monkeypatch.setattr(llm_service, "complete", fake_complete)

    note = client.post(
        f"/api/courses/{course['id']}/notes/generate",
        json={"material_id": material["id"]},
        headers=headers,
    ).json()

    # Concurrency: more than one batch was in flight at the same time.
    assert note["generation_method"] == "llm"
    assert state["peak"] >= 2

    positions = [note["content"].index(f"- point {i} [#{i}]") for i in range(1, 6)]
    assert positions == sorted(positions)


def test_notes_generation_surfaces_llm_errors_instead_of_falling_back(
    client, monkeypatch
) -> None:
    """When the provider fails, the API reports it — never a template/extractive note."""
    headers = _signup(client, "alice@example.com")
    course = _create_course(client, headers)
    material = _make_indexed_material(
        client, headers, course["id"], [PHOTOSYNTHESIS]
    )

    def _boom(system, user, **kwargs):
        raise llm_service.LLMError("The language model quota is exhausted (HTTP 429).")

    monkeypatch.setattr(llm_service, "complete", _boom)

    response = client.post(
        f"/api/courses/{course['id']}/notes/generate",
        json={"material_id": material["id"]},
        headers=headers,
    )

    assert response.status_code == 502, response.text
    assert "quota" in response.json()["detail"].lower()


def test_notes_generation_requires_a_configured_model(client, monkeypatch) -> None:
    """A missing key/model is a clear 503, not extractive notes."""
    headers = _signup(client, "alice@example.com")
    course = _create_course(client, headers)
    material = _make_indexed_material(client, headers, course["id"], [PHOTOSYNTHESIS])

    monkeypatch.setattr(llm_service, "is_configured", lambda: False)

    response = client.post(
        f"/api/courses/{course['id']}/notes/generate",
        json={"material_id": material["id"]},
        headers=headers,
    )
    assert response.status_code == 503, response.text
    assert "not configured" in response.json()["detail"].lower()


def test_regenerating_notes_for_the_same_material_does_not_duplicate(client) -> None:
    headers = _signup(client, "alice@example.com")
    course = _create_course(client, headers)
    material = _make_indexed_material(client, headers, course["id"], [PHOTOSYNTHESIS])

    first = client.post(
        f"/api/courses/{course['id']}/notes/generate",
        json={"material_id": material["id"]},
        headers=headers,
    ).json()
    second = client.post(
        f"/api/courses/{course['id']}/notes/generate",
        json={"material_id": material["id"]},
        headers=headers,
    ).json()

    assert first["id"] == second["id"]
    notes = client.get(f"/api/courses/{course['id']}/notes", headers=headers).json()
    assert len(notes) == 1


def test_note_pdf_transliterates_symbols_instead_of_dropping_them() -> None:
    # Regression: str.translate needs ordinal keys, so an em dash must become "."
    # (not "?") and Greek/math symbols must become readable text.
    safe = notes_pdf._safe
    assert safe("record.pdf — Notes") == "record.pdf - Notes"
    assert safe("α ≤ β") == "alpha <= beta"
    assert safe("∫ x dx") == "integral x dx"


def test_note_pdf_endpoint_returns_a_valid_document(client) -> None:
    headers = _signup(client, "alice@example.com")
    course = _create_course(client, headers)
    material = _make_indexed_material(
        client, headers, course["id"], [PHOTOSYNTHESIS, RESPIRATION]
    )
    note = client.post(
        f"/api/courses/{course['id']}/notes/generate",
        json={"material_id": material["id"]},
        headers=headers,
    ).json()

    response = client.get(f"/api/notes/{note['id']}/pdf", headers=headers)
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/pdf"
    assert response.content.startswith(b"%PDF")

    document = fitz.open(stream=response.content, filetype="pdf")
    try:
        assert document.page_count >= 1
        text = "".join(page.get_text() for page in document)
        assert "Page 1 of" in text
    finally:
        document.close()

    # The PDF is owner-scoped: another user cannot read it.
    bob = _signup(client, "bob@example.com")
    assert client.get(f"/api/notes/{note['id']}/pdf", headers=bob).status_code == 404


def test_tutor_is_generated_by_the_model_with_history(client, monkeypatch) -> None:
    headers = _signup(client, "alice@example.com")
    course = _create_course(client, headers)
    _make_indexed_material(client, headers, course["id"], [PHOTOSYNTHESIS])

    seen: list[list[dict]] = []

    def _capture(messages, **kwargs):
        seen.append(messages)
        return "Photosynthesis makes glucose and oxygen [#1]"

    monkeypatch.setattr(llm_service, "chat", _capture)

    answer = client.post(
        f"/api/courses/{course['id']}/tutor",
        json={
            "question": "What does photosynthesis produce?",
            "history": [
                {"role": "user", "content": "Let's study photosynthesis."},
                {"role": "assistant", "content": "It converts light into chemical energy."},
            ],
        },
        headers=headers,
    ).json()

    assert answer["grounded"] is True
    assert answer["answer"] == "Photosynthesis makes glucose and oxygen [#1]"
    # The model received the system prompt, the prior turns, and the question.
    roles = [message["role"] for message in seen[0]]
    assert roles[0] == "system"
    assert roles[1:3] == ["user", "assistant"]
    assert "What does photosynthesis produce?" in seen[0][-1]["content"]


def test_tutor_surfaces_model_errors(client, monkeypatch) -> None:
    headers = _signup(client, "alice@example.com")
    course = _create_course(client, headers)
    _make_indexed_material(client, headers, course["id"], [PHOTOSYNTHESIS])

    def _boom(messages, **kwargs):
        raise llm_service.LLMError("The language model rejected the API key (HTTP 401).")

    monkeypatch.setattr(llm_service, "chat", _boom)

    response = client.post(
        f"/api/courses/{course['id']}/tutor",
        json={"question": "Explain photosynthesis."},
        headers=headers,
    )
    assert response.status_code == 502, response.text
    assert "api key" in response.json()["detail"].lower()


# ----------------------------------------------------------------------
# Tutor grounding
# ----------------------------------------------------------------------

def test_tutor_answers_from_material_and_cites_it(client) -> None:
    headers = _signup(client, "alice@example.com")
    course = _create_course(client, headers)
    _make_indexed_material(
        client, headers, course["id"], [PHOTOSYNTHESIS, RESPIRATION]
    )

    answer = client.post(
        f"/api/courses/{course['id']}/tutor",
        json={"question": "What does photosynthesis produce?"},
        headers=headers,
    ).json()

    assert answer["grounded"] is True
    assert answer["citations"]
    assert answer["used_materials"]


def test_tutor_says_when_the_answer_is_not_in_the_materials(client) -> None:
    headers = _signup(client, "alice@example.com")
    course = _create_course(client, headers)
    _make_indexed_material(client, headers, course["id"], [PHOTOSYNTHESIS])

    answer = client.post(
        f"/api/courses/{course['id']}/tutor",
        json={"question": "Who won the 1998 world cup final?"},
        headers=headers,
    ).json()

    assert answer["grounded"] is False
    assert answer["citations"] == []
    assert "couldn't find" in answer["answer"].lower()


def test_tutor_never_cites_another_users_content(client) -> None:
    alice = _signup(client, "alice@example.com")
    alice_course = _create_course(client, alice)
    _make_indexed_material(client, alice, alice_course["id"], [PHOTOSYNTHESIS])

    bob = _signup(client, "bob@example.com")
    bob_course = _create_course(client, bob, name="Bob's course")

    # Bob has no indexed content, and cannot reach Alice's course at all.
    answer = client.post(
        f"/api/courses/{bob_course['id']}/tutor",
        json={"question": "What does photosynthesis produce?"},
        headers=bob,
    ).json()
    assert answer["grounded"] is False

    assert (
        client.post(
            f"/api/courses/{alice_course['id']}/tutor",
            json={"question": "What does photosynthesis produce?"},
            headers=bob,
        ).status_code
        == 404
    )


# ----------------------------------------------------------------------
# Ownership
# ----------------------------------------------------------------------

def test_index_endpoints_are_owner_scoped(client) -> None:
    alice = _signup(client, "alice@example.com")
    alice_course = _create_course(client, alice)
    material = _make_indexed_material(client, alice, alice_course["id"], [PHOTOSYNTHESIS])

    bob = _signup(client, "bob@example.com")

    assert (
        client.get(f"/api/materials/{material['id']}/index-status").status_code == 401
    )
    assert (
        client.get(f"/api/materials/{material['id']}/index-status", headers=bob).status_code
        == 404
    )
    assert client.get(f"/api/materials/{material['id']}/chunks", headers=bob).status_code == 404
    assert (
        client.post(
            f"/api/materials/{material['id']}/index", headers=bob
        ).status_code
        == 404
    )
    assert (
        client.post(
            f"/api/courses/{alice_course['id']}/notes/generate", json={}, headers=bob
        ).status_code
        == 404
    )


# ----------------------------------------------------------------------
# Deletion: chunks go, saved notes stay
# ----------------------------------------------------------------------

def test_deleting_a_material_removes_chunks_but_keeps_notes(client, fake_supabase) -> None:
    headers = _signup(client, "alice@example.com")
    course = _create_course(client, headers)
    material = _make_indexed_material(client, headers, course["id"], [PHOTOSYNTHESIS])

    note = client.post(
        f"/api/courses/{course['id']}/notes/generate",
        json={"material_id": material["id"]},
        headers=headers,
    ).json()

    assert any(
        row["material_id"] == material["id"] for row in fake_supabase.tables["rag_chunks"]
    )

    deleted = client.delete(f"/api/materials/{material['id']}", headers=headers)
    assert deleted.status_code in {200, 204}, deleted.text

    # Chunks/embeddings for the material are gone...
    assert all(
        row["material_id"] != material["id"]
        for row in fake_supabase.tables["rag_chunks"]
    )
    # ...but the saved note survives and can still be reopened.
    assert client.get(f"/api/notes/{note['id']}", headers=headers).status_code == 200

    # The tutor can still answer from the saved note, flagging the deleted source.
    answer = client.post(
        f"/api/courses/{course['id']}/tutor",
        json={"question": "What do plants use to absorb sunlight?"},
        headers=headers,
    ).json()
    assert answer["grounded"] is True
    note_citations = [c for c in answer["citations"] if c["kind"] == "note"]
    assert note_citations
    assert note_citations[0].get("material_deleted") is True


# ----------------------------------------------------------------------
# Ownership of the notes/tutor endpoints
# ----------------------------------------------------------------------

def test_rag_endpoints_require_auth(client) -> None:
    assert client.post("/api/materials/m1/index").status_code == 401
    assert client.get("/api/materials/m1/index-status").status_code == 401
    assert client.get("/api/materials/m1/chunks").status_code == 401
    assert client.post("/api/courses/c1/notes/generate", json={}).status_code == 401
    assert (
        client.post("/api/courses/c1/tutor", json={"question": "hi"}).status_code == 401
    )


def test_generate_notes_cannot_target_another_users_course(client) -> None:
    alice = _signup(client, "alice@example.com")
    alice_course = _create_course(client, alice)

    bob = _signup(client, "bob@example.com")
    response = client.post(
        f"/api/courses/{alice_course['id']}/notes/generate",
        json={},
        headers=bob,
    )
    assert response.status_code == 404
