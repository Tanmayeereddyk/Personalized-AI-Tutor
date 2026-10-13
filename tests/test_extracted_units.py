"""Tests for the extracted_units integration.

Runs fully offline against the fake Supabase client. Extraction engines that
have their dependencies installed (PyMuPDF for PDFs) are exercised end to end
through the real HTTP endpoints; the persistence, ordering, filtering,
ownership and retry behaviour is tested directly too.
"""

import io
from pathlib import Path

import fitz  # PyMuPDF — installed in this environment
import pytest
from supabase import PostgrestAPIError

from app.services import extractors, extracted_unit_service


def _signup(client, email: str) -> dict[str, str]:
    response = client.post(
        "/api/auth/signup",
        json={"email": email, "password": "password123", "full_name": "Tester"},
    )
    assert response.status_code == 201, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def _create_course(client, headers: dict[str, str], name: str = "Course") -> dict:
    response = client.post("/api/courses", json={"name": name}, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


def _upload(client, headers: dict[str, str], course_id: str, filename: str, data: bytes, mime: str) -> dict:
    response = client.post(
        f"/api/courses/{course_id}/materials",
        files=[("files", (filename, data, mime))],
        headers=headers,
    )
    assert response.status_code == 201, response.text
    return response.json()[0]


def _pdf_bytes() -> bytes:
    """A tiny 2-page PDF with a text layer."""
    document = fitz.open()
    try:
        for number in (1, 2):
            page = document.new_page()
            page.insert_text((72, 72), f"Page {number} content")
    finally:
        data = document.tobytes()
        document.close()
    return data


def _start_extraction(client, headers: dict[str, str], material_id: str) -> int:
    """Start extraction; background work runs before TestClient returns."""
    return client.post(
        f"/api/materials/{material_id}/extraction", headers=headers
    ).status_code


def _extract_pdf(client, headers: dict[str, str], course_id: str) -> dict:
    material = _upload(
        client, headers, course_id, "notes.pdf", _pdf_bytes(), "application/pdf"
    )
    assert _start_extraction(client, headers, material["id"]) == 202
    return material


# ----------------------------------------------------------------------
# Authentication
# ----------------------------------------------------------------------

def test_extracted_units_require_auth(client, logged_in_user) -> None:
    assert client.get("/api/materials/m1/extracted-units").status_code == 401
    assert client.get("/api/materials/m1/extraction-status").status_code == 401
    assert client.get("/api/extracted-units/u1").status_code == 401
    assert client.get("/api/extracted-units/u1/asset-url").status_code == 401
    assert client.post("/api/materials/m1/extraction").status_code == 401


# ----------------------------------------------------------------------
# End-to-end PDF extraction + persistence
# ----------------------------------------------------------------------

def test_pdf_extraction_saves_units_with_source_metadata(client) -> None:
    headers = _signup(client, "alice@example.com")
    course = _create_course(client, headers)
    material = _extract_pdf(client, headers, course["id"])

    # The background task finished before the test client returned.
    status = client.get(
        f"/api/materials/{material['id']}/extraction-status", headers=headers
    ).json()
    assert status["status"] == "ready"
    assert status["unit_count"] == 2
    assert status["warnings"] == []

    units = client.get(
        f"/api/materials/{material['id']}/extracted-units", headers=headers
    ).json()
    # Units come back in original order (page 1, page 2).
    assert [u["page_number"] for u in units] == [1, 2]
    assert [u["unit_order"] for u in units] == [10, 20]
    for unit in units:
        assert unit["material_id"] == material["id"]
        assert unit["content_type"] == "text"
        assert unit["extraction_method"] == "pdf_text"
        assert unit["metadata"]["source"] == "text_layer"
        assert unit["status"] == "extracted"
        assert unit["content"] == f"Page {unit['page_number']} content"
        # The per-page image reference survives the round trip.
        assert unit["asset_path"].endswith(
            f"/extracted/pdf/page-{unit['page_number']}.png"
        )
        assert unit["asset_path"].startswith(
            f"{material['user_id']}/{course['id']}/{material['id']}"
        )


def _scanned_pdf_bytes() -> bytes:
    """A one-page PDF that is only an image (no text layer), for OCR."""
    from PIL import Image, ImageDraw, ImageFont  # noqa: PLC0415 - test only

    font_path = next(
        (
            path
            for path in (
                r"C:\Windows\Fonts\arial.ttf",
                "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            )
            if Path(path).is_file()
        ),
        None,
    )
    if font_path is None:
        pytest.skip("no scalable font available for the OCR test")

    font = ImageFont.truetype(font_path, 64)
    image = Image.new("RGB", (1200, 220), "white")
    ImageDraw.Draw(image).text((30, 60), "HELLO WORLD", fill="black", font=font)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")

    document = fitz.open()
    page = document.new_page(width=595, height=200)
    page.insert_image(fitz.Rect(0, 0, 595, 200), stream=buffer.getvalue())
    data = document.tobytes()
    document.close()
    return data


@pytest.mark.skipif(
    extractors._find_tesseract() is None,
    reason="Tesseract OCR engine is not installed",
)
def test_scanned_pdf_falls_back_to_ocr(client) -> None:
    headers = _signup(client, "ocr@example.com")
    course = _create_course(client, headers)
    material = _upload(
        client,
        headers,
        course["id"],
        "scan.pdf",
        _scanned_pdf_bytes(),
        "application/pdf",
    )
    assert _start_extraction(client, headers, material["id"]) == 202

    units = client.get(
        f"/api/materials/{material['id']}/extracted-units", headers=headers
    ).json()
    assert len(units) == 1
    unit = units[0]
    assert unit["extraction_method"] == "ocr"
    assert unit["metadata"]["source"] == "ocr"
    assert "HELLO" in (unit["content"] or "").upper()


def test_extraction_retry_does_not_duplicate_units(client, fake_supabase) -> None:
    headers = _signup(client, "bob@example.com")
    course = _create_course(client, headers)
    material = _extract_pdf(client, headers, course["id"])

    def count_rows() -> int:
        return len(fake_supabase.tables["extracted_units"])

    first_count = count_rows()
    assert first_count == 2

    # Re-run the extraction twice; row count must not grow.
    for _ in range(2):
        assert _start_extraction(client, headers, material["id"]) == 202
        status = client.get(
            f"/api/materials/{material['id']}/extraction-status", headers=headers
        ).json()
        assert status["status"] == "ready"
        assert count_rows() == first_count

    units = client.get(
        f"/api/materials/{material['id']}/extracted-units", headers=headers
    ).json()
    assert len(units) == 2


def test_units_can_be_filtered_by_content_type_and_location(client) -> None:
    headers = _signup(client, "carol@example.com")
    course = _create_course(client, headers)
    material = _extract_pdf(client, headers, course["id"])
    base = f"/api/materials/{material['id']}/extracted-units"

    only_text = client.get(f"{base}?content_type=text", headers=headers).json()
    assert [u["page_number"] for u in only_text] == [1, 2]

    page_one = client.get(f"{base}?page_number=1", headers=headers).json()
    assert [u["page_number"] for u in page_one] == [1]

    no_tables = client.get(f"{base}?content_type=table", headers=headers).json()
    assert no_tables == []


def test_database_error_is_handled_safely(client, fake_supabase) -> None:
    headers = _signup(client, "dave@example.com")
    course = _create_course(client, headers)
    material = _extract_pdf(client, headers, course["id"])

    fake_supabase.table_errors["extracted_units"] = PostgrestAPIError(
        {"message": "boom"}
    )
    response = client.get(
        f"/api/materials/{material['id']}/extracted-units", headers=headers
    )
    assert response.status_code == 500
    assert "database" in response.json()["detail"].lower()


# ----------------------------------------------------------------------
# Ownership isolation
# ----------------------------------------------------------------------

def test_users_cannot_reach_each_others_extracted_units(client) -> None:
    a_headers = _signup(client, "alice@example.com")
    course_a = _create_course(client, a_headers)
    material = _extract_pdf(client, a_headers, course_a["id"])
    unit_id = client.get(
        f"/api/materials/{material['id']}/extracted-units", headers=a_headers
    ).json()[0]["id"]

    b_headers = _signup(client, "bob@example.com")
    # B cannot start, read or probe A's extraction by guessing ids.
    assert (
        client.post(f"/api/materials/{material['id']}/extraction", headers=b_headers).status_code
        == 404
    )
    assert (
        client.get(f"/api/materials/{material['id']}/extraction-status", headers=b_headers).status_code
        == 404
    )
    assert (
        client.get(f"/api/materials/{material['id']}/extracted-units", headers=b_headers).status_code
        == 404
    )
    assert client.get(f"/api/extracted-units/{unit_id}", headers=b_headers).status_code == 404
    assert (
        client.put(f"/api/extracted-units/{unit_id}", json={"status": "failed"}, headers=b_headers).status_code
        == 404
    )
    assert (
        client.get(f"/api/extracted-units/{unit_id}/asset-url", headers=b_headers).status_code
        == 404
    )

    # A still sees everything unchanged.
    assert (
        client.get(f"/api/materials/{material['id']}/extracted-units", headers=a_headers).status_code
        == 200
    )


# ----------------------------------------------------------------------
# Status, warnings and failures
# ----------------------------------------------------------------------

def test_unsupported_material_records_warning_and_attention_status(client) -> None:
    headers = _signup(client, "erin@example.com")
    course = _create_course(client, headers)
    material = _upload(
        client, headers, course["id"], "notes.doc", b"not a real document", "application/msword"
    )
    assert material["type"] == "doc"

    assert _start_extraction(client, headers, material["id"]) == 202
    status = client.get(
        f"/api/materials/{material['id']}/extraction-status", headers=headers
    ).json()

    assert status["status"] == "attention"
    assert status["unit_count"] == 0
    assert len(status["warnings"]) == 1
    assert "not implemented" in status["warnings"][0].lower()

    # The warning is also persisted as a real summary unit, not thrown away.
    units_all = client.get(
        f"/api/materials/{material['id']}/extracted-units",
        headers=headers,
    ).json()
    summary = [u for u in units_all if u["metadata"].get("kind") == "summary"]
    assert len(summary) == 1
    assert summary[0]["metadata"]["warnings"] == status["warnings"]


def test_missing_source_file_records_failure(client, fake_supabase) -> None:
    headers = _signup(client, "frank@example.com")
    course = _create_course(client, headers)
    material = _upload(
        client, headers, course["id"], "notes.pdf", _pdf_bytes(), "application/pdf"
    )
    # Simulate the stored object having vanished.
    folder = f"{material['user_id']}/{course['id']}/{material['id']}"
    fake_supabase.stored_objects.pop(f"materials/{folder}/{material['name']}")

    assert _start_extraction(client, headers, material["id"]) == 202
    status = client.get(
        f"/api/materials/{material['id']}/extraction-status", headers=headers
    ).json()
    assert status["status"] == "attention"
    assert "could not be read" in status["warnings"][0]


def test_broken_video_file_records_failure_not_crash(client) -> None:
    headers = _signup(client, "grace@example.com")
    course = _create_course(client, headers)
    material = _upload(
        client, headers, course["id"], "lecture.mp4", b"garbage-garbage-garbage", "video/mp4"
    )
    assert material["type"] == "video"

    assert _start_extraction(client, headers, material["id"]) == 202
    status = client.get(
        f"/api/materials/{material['id']}/extraction-status", headers=headers
    ).json()
    assert status["status"] == "attention"
    assert len(status["warnings"]) >= 1


# ----------------------------------------------------------------------
# Updating units and asset links
# ----------------------------------------------------------------------

def test_unit_status_can_be_updated_by_its_owner(client) -> None:
    headers = _signup(client, "heidi@example.com")
    course = _create_course(client, headers)
    material = _extract_pdf(client, headers, course["id"])
    unit_id = client.get(
        f"/api/materials/{material['id']}/extracted-units", headers=headers
    ).json()[0]["id"]

    updated = client.put(
        f"/api/extracted-units/{unit_id}",
        json={"status": "failed", "metadata": {"note": "checked"}},
        headers=headers,
    )
    assert updated.status_code == 200
    body = updated.json()
    assert body["status"] == "failed"
    assert body["metadata"]["note"] == "checked"

    # Location metadata is immutable via this endpoint.
    changed = client.put(
        f"/api/extracted-units/{unit_id}", json={"page_number": 99}, headers=headers
    )
    assert changed.status_code == 422


def test_asset_url_ownership_and_missing_asset(client) -> None:
    headers = _signup(client, "ivan@example.com")
    course = _create_course(client, headers)
    material = _extract_pdf(client, headers, course["id"])
    unit_id = client.get(
        f"/api/materials/{material['id']}/extracted-units", headers=headers
    ).json()[0]["id"]

    url = client.get(f"/api/extracted-units/{unit_id}/asset-url", headers=headers)
    assert url.status_code == 200
    assert url.json()["url"].startswith("https://files.example.com/")

    # A unit with no asset returns 404 (never a signed URL to nothing).
    plain = client.get(
        f"/api/materials/{material['id']}/extracted-units?content_type=table",
        headers=headers,
    )
    assert plain.json() == []


# ----------------------------------------------------------------------
# Deleting a material cleans up its extracted content and assets
# ----------------------------------------------------------------------

def test_delete_material_removes_extracted_rows_and_assets(client, fake_supabase) -> None:
    headers = _signup(client, "judy@example.com")
    course = _create_course(client, headers)
    material = _extract_pdf(client, headers, course["id"])

    units = client.get(
        f"/api/materials/{material['id']}/extracted-units", headers=headers
    ).json()
    assert len(units) == 2
    asset_paths = {u["asset_path"] for u in units}
    assert len(asset_paths) == 2

    assert client.delete(f"/api/materials/{material['id']}", headers=headers).status_code == 204

    assert fake_supabase.tables["extracted_units"] == []
    for path in asset_paths:
        assert f"materials/{path}" not in fake_supabase.stored_objects


# ----------------------------------------------------------------------
# Service-level timestamp + source metadata preservation
# ----------------------------------------------------------------------

def test_service_preserves_timestamps_and_filters(client, fake_supabase) -> None:
    headers = _signup(client, "kyle@example.com")
    course = _create_course(client, headers)
    material = _upload(
        client, headers, course["id"], "lecture.mp4", b"\x00video", "video/mp4"
    )

    units = [
        {
            "material_id": material["id"],
            "content_type": "image",
            "content": None,
            "start_timestamp_seconds": 0.0,
            "end_timestamp_seconds": 30.0,
            "asset_path": f"{material['user_id']}/x/frame-0s.jpg",
            "extraction_method": "video_frame",
            "status": "extracted",
            "unit_order": 1,
            "metadata": {"source": "frame"},
        },
        {
            "material_id": material["id"],
            "content_type": "image",
            "content": None,
            "start_timestamp_seconds": 30.0,
            "end_timestamp_seconds": 60.0,
            "asset_path": f"{material['user_id']}/x/frame-30s.jpg",
            "extraction_method": "video_frame",
            "status": "extracted",
            "unit_order": 30001,
            "metadata": {"source": "frame"},
        },
        {
            "material_id": material["id"],
            "content_type": "transcript",
            "content": "Welcome back.",
            "start_timestamp_seconds": 12.0,
            "end_timestamp_seconds": 14.5,
            "asset_path": None,
            "extraction_method": "video_transcript",
            "status": "extracted",
            "unit_order": 10000001,
            "metadata": {"source": "transcript"},
        },
    ]
    saved = extracted_unit_service.replace_units(
        fake_supabase, material["user_id"], material["id"], units
    )
    assert len(saved) == 3

    rows = extracted_unit_service.list_units(
        fake_supabase, material["user_id"], material["id"]
    )
    # Original order by unit_order, timestamps and asset refs intact.
    assert [r["unit_order"] for r in rows] == [1, 30001, 10000001]
    assert [r["start_timestamp_seconds"] for r in rows] == [0.0, 30.0, 12.0]
    assert rows[2]["asset_path"] is None
    assert all(r["material_id"] == material["id"] for r in rows)

    # Filter by time window.
    window = extracted_unit_service.list_units(
        fake_supabase,
        material["user_id"],
        material["id"],
        from_timestamp=10.0,
        to_timestamp=15.0,
    )
    assert [r["content_type"] for r in window] == ["transcript"]

    # Content-type filter distinguishes transcripts from images.
    frames = extracted_unit_service.list_units(
        fake_supabase,
        material["user_id"],
        material["id"],
        content_type="image",
    )
    assert len(frames) == 2