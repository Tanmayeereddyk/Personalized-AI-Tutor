"""Tests for the inline presentation preview (``.pptx`` → PDF / slides).

The preview is a *viewer* convenience layered on top of extraction, so
these tests pin the behaviours that matter for it:

- A never-converted deck is converted once and cached in the material's
  own storage folder (the durable "ready" marker), then reused.
- The original ``.pptx`` stays downloadable and unchanged.
- When LibreOffice is not installed (or conversion fails) the viewer
  degrades to the slide text the extraction pipeline already produced,
  ordered by slide number, with a clear message — and the download keeps
  working.
- Preview generation never touches the material's processing status, so
  it is never mistaken for proof that extraction/indexing succeeded.

The genuine LibreOffice conversion is exercised end to end only when a
LibreOffice install is present; otherwise it is skipped (the monkeypatched
conversion path still covers the orchestration everywhere else).
"""

import uuid

import pytest

from app.services import office_conversion, preview_service

# ----------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------

PPTX_BYTES = (
    b"PK\x03\x04not-a-real-pptx-but-the-converter-is-mocked-or-real"
)


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


def _user_id(client, headers: dict[str, str]) -> str:
    """The signed-in user's id, straight from the auth endpoint."""
    response = client.get("/api/auth/me", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()["user"]["id"]


def _seed_material(
    fake,
    user_id: str,
    course_id: str,
    name: str,
    data: bytes,
    *,
    material_type: str = "ppt",
    mime: str = "application/vnd.openxmlformats-officedocument.presentationml.presentation",
) -> str:
    """Insert an unprocessed material row + its stored file."""
    material_id = str(uuid.uuid4())
    storage_path = f"{user_id}/{course_id}/{material_id}/{name}"
    fake.stored_objects[f"materials/{storage_path}"] = data
    fake.tables.setdefault("materials", []).append(
        {
            "id": material_id,
            "user_id": user_id,
            "course_id": course_id,
            "name": name,
            "type": material_type,
            "kind": "Upload",
            "size_bytes": len(data),
            "mime_type": mime,
            "storage_path": storage_path,
            "status": "ready",
        }
    )
    return material_id


def _seed_slide_unit(
    fake, material_id: str, number: int, text: str, unit_order: int
) -> None:
    fake.tables.setdefault("extracted_units", []).append(
        {
            "id": str(uuid.uuid4()),
            "material_id": material_id,
            "content_type": "text",
            "content": text,
            "page_number": None,
            "slide_number": number,
            "start_timestamp_seconds": None,
            "end_timestamp_seconds": None,
            "asset_path": None,
            "extraction_method": "pptx_text",
            "status": "extracted",
            "unit_order": unit_order,
            "metadata": {"source": "text_layer"},
            "created_at": None,
            "updated_at": None,
        }
    )


@pytest.fixture(autouse=True)
def _clean_preview_stages():
    """Keep the process-local conversion stages isolated per test."""
    preview_service._PREVIEW_STAGES.clear()
    yield
    preview_service._PREVIEW_STAGES.clear()


# ----------------------------------------------------------------------
# Graceful fallback when LibreOffice is not installed
# ----------------------------------------------------------------------

def test_preview_falls_back_to_slides_without_libreoffice(client, fake_supabase) -> None:
    headers = _signup(client, "fallback@example.com")
    course = _create_course(client, headers)
    user_id = _user_id(client, headers)
    material_id = _seed_material(
        fake_supabase, user_id, course["id"], "deck.pptx", PPTX_BYTES
    )
    # The extraction pipeline already produced slide text (out of order).
    _seed_slide_unit(fake_supabase, material_id, 3, "Third slide", 30)
    _seed_slide_unit(fake_supabase, material_id, 1, "First slide", 10)
    _seed_slide_unit(fake_supabase, material_id, 2, "Second slide", 20)

    response = client.get(
        f"/api/materials/{material_id}/preview", headers=headers
    )
    assert response.status_code == 200, response.text
    body = response.json()

    assert body["status"] == "unsupported"
    assert body["mode"] == "slides"
    assert body["url"] is None
    assert "LibreOffice" in (body["message"] or "")

    # Slide text is reused from extraction and rendered in slide order.
    slides = body["slides"]
    assert [slide["number"] for slide in slides] == [1, 2, 3]
    assert [slide["text"] for slide in slides] == [
        "First slide",
        "Second slide",
        "Third slide",
    ]


def test_preview_reports_none_when_no_slides_yet(client, fake_supabase) -> None:
    """A deck with no extracted text yet has nothing to fall back to."""
    headers = _signup(client, "noslides@example.com")
    course = _create_course(client, headers)
    user_id = _user_id(client, headers)
    material_id = _seed_material(
        fake_supabase, user_id, course["id"], "deck.pptx", PPTX_BYTES
    )

    response = client.get(
        f"/api/materials/{material_id}/preview", headers=headers
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "unsupported"
    assert body["mode"] == "none"
    assert body["slides"] == []


# ----------------------------------------------------------------------
# Conversion, caching and the preserved original
# ----------------------------------------------------------------------

def test_preview_converts_once_and_caches_the_pdf(
    client, fake_supabase, monkeypatch
) -> None:
    headers = _signup(client, "convert@example.com")
    course = _create_course(client, headers)
    user_id = _user_id(client, headers)
    material_id = _seed_material(
        fake_supabase, user_id, course["id"], "deck.pptx", PPTX_BYTES
    )

    monkeypatch.setattr(preview_service, "find_soffice", lambda: "soffice")
    conversions = {"count": 0}

    def fake_convert(soffice, content, filename):
        conversions["count"] += 1
        assert content == PPTX_BYTES
        return b"%PDF-1.4 converted-slides"

    monkeypatch.setattr(preview_service, "convert_to_pdf", fake_convert)

    # First open starts the conversion (202) and the background task runs
    # inline under TestClient.
    started = client.post(
        f"/api/materials/{material_id}/preview", headers=headers
    )
    assert started.status_code == 202, started.text
    assert started.json()["status"] == "processing"
    assert conversions["count"] == 1

    # The converted PDF is cached under the material's own folder.
    expected_path = (
        f"materials/{user_id}/{course['id']}/{material_id}"
        "/preview/preview.pdf"
    )
    assert fake_supabase.stored_objects.get(expected_path) == b"%PDF-1.4 converted-slides"

    # A poll now reports the cached preview as ready with a signed URL.
    polled = client.get(
        f"/api/materials/{material_id}/preview", headers=headers
    )
    assert polled.status_code == 200, polled.text
    body = polled.json()
    assert body["status"] == "ready"
    assert body["mode"] == "pdf"
    assert body["url"] and "preview.pdf" in body["url"]

    # Re-opening an already-converted material never converts it again.
    again = client.post(
        f"/api/materials/{material_id}/preview", headers=headers
    )
    assert again.status_code == 202, again.text
    assert again.json()["status"] == "ready"
    assert conversions["count"] == 1


def test_preview_keeps_original_file_downloadable(
    client, fake_supabase, monkeypatch
) -> None:
    headers = _signup(client, "download@example.com")
    course = _create_course(client, headers)
    user_id = _user_id(client, headers)
    material_id = _seed_material(
        fake_supabase, user_id, course["id"], "deck.pptx", PPTX_BYTES
    )

    monkeypatch.setattr(preview_service, "find_soffice", lambda: "soffice")
    monkeypatch.setattr(
        preview_service,
        "convert_to_pdf",
        lambda soffice, content, filename: b"%PDF-1.4 converted",
    )
    client.post(f"/api/materials/{material_id}/preview", headers=headers)

    # The original .pptx is still served by the existing file endpoint,
    # and its stored bytes are untouched.
    url = client.get(f"/api/materials/{material_id}/url", headers=headers)
    assert url.status_code == 200, url.text
    assert url.json()["url"]
    assert fake_supabase.stored_objects[
        f"materials/{user_id}/{course['id']}/{material_id}/deck.pptx"
    ] == PPTX_BYTES


def test_preview_failure_is_explained_and_download_survives(
    client, fake_supabase, monkeypatch
) -> None:
    headers = _signup(client, "fail@example.com")
    course = _create_course(client, headers)
    user_id = _user_id(client, headers)
    material_id = _seed_material(
        fake_supabase, user_id, course["id"], "deck.pptx", PPTX_BYTES
    )
    _seed_slide_unit(fake_supabase, material_id, 1, "Only slide", 10)

    monkeypatch.setattr(preview_service, "find_soffice", lambda: "soffice")

    def broken_convert(soffice, content, filename):
        raise preview_service.PreviewError("Could not render the slides (boom).")

    monkeypatch.setattr(preview_service, "convert_to_pdf", broken_convert)

    response = client.post(
        f"/api/materials/{material_id}/preview", headers=headers
    )
    assert response.status_code == 202, response.text

    polled = client.get(
        f"/api/materials/{material_id}/preview", headers=headers
    )
    assert polled.status_code == 200, polled.text
    body = polled.json()
    assert body["status"] == "failed"
    assert "render" in (body["message"] or "").lower()

    # The slide-text fallback is still offered alongside the failure.
    assert body["mode"] == "slides"
    assert [slide["text"] for slide in body["slides"]] == ["Only slide"]

    # And the original file is still downloadable.
    url = client.get(f"/api/materials/{material_id}/url", headers=headers)
    assert url.status_code == 200, url.text


# ----------------------------------------------------------------------
# Guard rails
# ----------------------------------------------------------------------

def test_preview_rejects_non_presentations(client, fake_supabase) -> None:
    headers = _signup(client, "pdf@example.com")
    course = _create_course(client, headers)
    user_id = _user_id(client, headers)
    material_id = _seed_material(
        fake_supabase,
        user_id,
        course["id"],
        "notes.pdf",
        b"%PDF-1.4 pdf",
        material_type="pdf",
        mime="application/pdf",
    )

    response = client.post(
        f"/api/materials/{material_id}/preview", headers=headers
    )
    assert response.status_code == 400, response.text
    assert "presentations" in response.json()["detail"]


def test_preview_is_private_to_the_owner(client, fake_supabase) -> None:
    owner = _signup(client, "owner@example.com")
    course = _create_course(client, owner)
    owner_id = owner["Authorization"].split("token-")[-1]
    material_id = _seed_material(
        fake_supabase, owner_id, course["id"], "deck.pptx", PPTX_BYTES
    )

    # A different user cannot read or start someone else's preview.
    stranger = _signup(client, "stranger@example.com")
    assert (
        client.get(f"/api/materials/{material_id}/preview", headers=stranger).status_code
        == 404
    )
    assert (
        client.post(f"/api/materials/{material_id}/preview", headers=stranger).status_code
        == 404
    )


def test_preview_does_not_change_material_processing_status(
    client, fake_supabase, monkeypatch
) -> None:
    """A preview is a viewer convenience, never proof of extraction."""
    headers = _signup(client, "status@example.com")
    course = _create_course(client, headers)
    user_id = _user_id(client, headers)
    material_id = _seed_material(
        fake_supabase, user_id, course["id"], "deck.pptx", PPTX_BYTES
    )

    monkeypatch.setattr(preview_service, "find_soffice", lambda: "soffice")
    monkeypatch.setattr(
        preview_service,
        "convert_to_pdf",
        lambda soffice, content, filename: b"%PDF-1.4 converted",
    )
    client.post(f"/api/materials/{material_id}/preview", headers=headers)

    material = client.get(f"/api/materials/{material_id}", headers=headers)
    assert material.status_code == 200, material.text
    assert material.json()["status"] == "ready"


# ----------------------------------------------------------------------
# Genuine LibreOffice conversion (skipped when LibreOffice is absent)
# ----------------------------------------------------------------------

def _build_pptx_bytes(slide_texts: list[str]) -> bytes:
    """A real multi-slide .pptx, one title placeholder per slide."""
    from pptx import Presentation

    presentation = Presentation()
    for text in slide_texts:
        slide = presentation.slides.add_slide(presentation.slide_layouts[1])
        slide.shapes.title.text = text
    import io

    buffer = io.BytesIO()
    presentation.save(buffer)
    return buffer.getvalue()


@pytest.mark.skipif(
    not preview_service.conversion_available(),
    reason="LibreOffice is not installed in this environment",
)
def test_real_libreoffice_conversion_renders_slides_in_order() -> None:
    """End to end: a 3-slide .pptx becomes a 3-page PDF, in order."""
    import fitz

    slides = ["Alpha intro slide", "Beta middle slide", "Gamma closing slide"]
    content = _build_pptx_bytes(slides)

    soffice = preview_service.find_soffice()
    assert soffice
    pdf = office_conversion.convert_to_pdf(soffice, content, "deck.pptx")

    assert pdf.startswith(b"%PDF")
    document = fitz.open(stream=pdf, filetype="pdf")
    try:
        assert document.page_count == len(slides)
        # Each slide's text lands on its own page, in order.
        for index, text in enumerate(slides):
            assert text in document[index].get_text()
    finally:
        document.close()
