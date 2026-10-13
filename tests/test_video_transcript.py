"""Tests for local Whisper video-audio transcription.

Everything here runs offline: the ffmpeg / ffprobe / Whisper boundaries are
monkeypatched, so the extraction logic itself is exercised — provenance and
timestamps on every unit, the warnings for silent or unreadable audio, the
temp-file cleanup and the transcript retrieval endpoint — without decoding
real media or loading a model.
"""

import os

from app.services import extracted_unit_service, extractors

MATERIAL = {
    "id": "m1",
    "user_id": "u1",
    "type": "video",
    "name": "lecture.mp4",
    "storage_path": "u1/m1/lecture.mp4",
}


def _signup(client, email: str) -> dict[str, str]:
    response = client.post(
        "/api/auth/signup",
        json={"email": email, "password": "password123", "full_name": "Tester"},
    )
    assert response.status_code == 201, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def _create_course(client, headers: dict[str, str]) -> dict:
    response = client.post("/api/courses", json={"name": "Course"}, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


def _upload_video(client, headers: dict[str, str], course_id: str) -> dict:
    response = client.post(
        f"/api/courses/{course_id}/materials",
        files=[("files", ("lecture.mp4", b"\x00video", "video/mp4"))],
        headers=headers,
    )
    assert response.status_code == 201, response.text
    return response.json()[0]


def _temp_audio(tmp_path) -> str:
    path = tmp_path / "audio.wav"
    path.write_bytes(b"RIFF" + b"\x00" * 64)
    return str(path)


# ----------------------------------------------------------------------
# Segment mapping
# ----------------------------------------------------------------------

def test_transcript_units_keep_timestamps_language_and_provenance() -> None:
    transcription = {
        "language": "en",
        "segments": [
            {"start": 12.04, "end": 18.9, "text": "  Welcome back.  "},
            {"start": 18.9, "end": 21.0, "text": ""},  # dropped: no speech
            {"start": 21.0, "end": 25.5, "text": "Let's begin."},
        ],
    }
    units = extractors._transcript_units(MATERIAL, transcription, 10_000_000)

    assert len(units) == 2
    first = units[0]
    assert first["material_id"] == "m1"
    assert first["content_type"] == "text"
    assert first["content"] == "Welcome back."
    assert first["start_timestamp_seconds"] == 12.04
    assert first["end_timestamp_seconds"] == 18.9
    assert first["extraction_method"] == "whisper_transcription"
    assert first["status"] == "extracted"
    assert first["unit_order"] == 10_000_001
    assert first["metadata"] == {
        "source": "audio_transcript",
        "kind": "transcript",
        "language": "en",
        "segment": 1,
    }
    # The original segment number is preserved, so order stays stable even
    # when a segment carried no speech.
    assert units[1]["unit_order"] == 10_000_003
    assert units[1]["metadata"]["segment"] == 3


# ----------------------------------------------------------------------
# Audio extraction + transcription flow
# ----------------------------------------------------------------------

def test_transcribes_audio_reports_stages_and_cleans_up(monkeypatch, tmp_path) -> None:
    audio = _temp_audio(tmp_path)

    monkeypatch.setattr(extractors, "_transcribe_available", lambda: True)
    monkeypatch.setattr(extractors, "_has_audio_stream", lambda _p: True)
    monkeypatch.setattr(extractors, "_extract_audio_track", lambda _p: (audio, None))
    monkeypatch.setattr(
        extractors,
        "_transcribe_audio",
        lambda _p: {"language": "es", "segments": [{"start": 0, "end": 2, "text": "Hola."}]},
    )

    stages: list[str] = []
    units, warnings = extractors.extract_transcript_units(
        MATERIAL, "video.mp4", on_stage=stages.append
    )

    assert warnings == []
    assert stages == ["extracting_audio", "transcribing"]
    assert [u["content"] for u in units] == ["Hola."]
    assert units[0]["extraction_method"] == "whisper_transcription"
    assert units[0]["metadata"]["language"] == "es"
    # The temporary audio file is always removed, success or not.
    assert not os.path.exists(audio)


def test_no_audio_stream_is_reported_without_running_ffmpeg(monkeypatch) -> None:
    monkeypatch.setattr(extractors, "_transcribe_available", lambda: True)
    monkeypatch.setattr(extractors, "_has_audio_stream", lambda _p: False)
    called = {"extract": False}

    def _extract(_path):
        called["extract"] = True
        return None, None

    monkeypatch.setattr(extractors, "_extract_audio_track", _extract)

    units, warnings = extractors.extract_transcript_units(MATERIAL, "silent.mp4")

    assert units == []
    assert called["extract"] is False
    assert "no audio" in warnings[0].lower()


def test_empty_transcription_warns_about_unclear_speech(monkeypatch, tmp_path) -> None:
    audio = _temp_audio(tmp_path)
    monkeypatch.setattr(extractors, "_transcribe_available", lambda: True)
    monkeypatch.setattr(extractors, "_has_audio_stream", lambda _p: True)
    monkeypatch.setattr(extractors, "_extract_audio_track", lambda _p: (audio, None))
    monkeypatch.setattr(extractors, "_transcribe_audio", lambda _p: {"segments": []})

    units, warnings = extractors.extract_transcript_units(MATERIAL, "silent.mp4")

    assert units == []
    assert "no clear speech" in warnings[0].lower()
    assert not os.path.exists(audio)


def test_whisper_missing_records_a_warning(monkeypatch) -> None:
    monkeypatch.setattr(extractors, "_transcribe_available", lambda: False)
    units, warnings = extractors.extract_transcript_units(MATERIAL, "video.mp4")
    assert units == []
    assert "whisper" in warnings[0].lower()


def test_transcription_crash_is_warned_and_audio_removed(monkeypatch, tmp_path) -> None:
    audio = _temp_audio(tmp_path)
    monkeypatch.setattr(extractors, "_transcribe_available", lambda: True)
    monkeypatch.setattr(extractors, "_has_audio_stream", lambda _p: True)
    monkeypatch.setattr(extractors, "_extract_audio_track", lambda _p: (audio, None))

    def boom(_path):
        raise RuntimeError("model exploded")

    monkeypatch.setattr(extractors, "_transcribe_audio", boom)

    units, warnings = extractors.extract_transcript_units(MATERIAL, "video.mp4")

    assert units == []
    assert "model exploded" in warnings[0]
    assert not os.path.exists(audio)


# ----------------------------------------------------------------------
# ffmpeg helpers
# ----------------------------------------------------------------------

def test_extract_audio_track_warns_when_ffmpeg_missing(monkeypatch) -> None:
    monkeypatch.setattr(extractors, "_find_ffmpeg", lambda: None)
    path, warning = extractors._extract_audio_track("video.mp4")
    assert path is None
    assert warning and "ffmpeg" in warning


def test_extract_audio_track_reports_ffmpeg_failure(monkeypatch) -> None:
    monkeypatch.setattr(extractors, "_find_ffmpeg", lambda: "ffmpeg")

    class Completed:
        returncode = 1
        stderr = "boom"
        stdout = ""

    monkeypatch.setattr(extractors, "subprocess", type("P", (), {"run": staticmethod(lambda *a, **k: Completed())}))

    path, warning = extractors._extract_audio_track("video.mp4")
    assert path is None
    assert warning and "could not be extracted" in warning.lower()


# ----------------------------------------------------------------------
# Retrieval endpoint
# ----------------------------------------------------------------------

def test_transcript_endpoint_returns_segments_and_enforces_ownership(    client, fake_supabase
) -> None:
    assert client.get("/api/materials/m1/transcript").status_code == 401

    headers = _signup(client, "vera@example.com")
    course = _create_course(client, headers)
    material = _upload_video(client, headers, course["id"])

    rows = [
        {
            "material_id": material["id"],
            "content_type": "text",
            "content": "Hello world.",
            "start_timestamp_seconds": 0.0,
            "end_timestamp_seconds": 3.0,
            "extraction_method": "whisper_transcription",
            "status": "extracted",
            "unit_order": 10_000_001,
            "metadata": {"source": "audio_transcript", "kind": "transcript"},
        },
        {
            "material_id": material["id"],
            "content_type": "text",
            "content": "Goodbye.",
            "start_timestamp_seconds": 3.0,
            "end_timestamp_seconds": 5.0,
            "extraction_method": "whisper_transcription",
            "status": "extracted",
            "unit_order": 10_000_002,
            "metadata": {"source": "audio_transcript", "kind": "transcript"},
        },
        # A non-transcript text unit must not leak into the transcript feed.
        {
            "material_id": material["id"],
            "content_type": "text",
            "content": "Page 1 of the handout",
            "extraction_method": "pdf_text",
            "status": "extracted",
            "unit_order": 1,
            "metadata": {"source": "text"},
        },
    ]
    extracted_unit_service.replace_units(
        fake_supabase, material["user_id"], material["id"], rows
    )

    response = client.get(
        f"/api/materials/{material['id']}/transcript", headers=headers
    )
    assert response.status_code == 200
    body = response.json()
    assert [row["content"] for row in body] == ["Hello world.", "Goodbye."]
    assert body[0]["start_timestamp_seconds"] == 0.0
    assert body[0]["extraction_method"] == "whisper_transcription"

    # Another user gets the same 404 as a non-existent material.
    other = _signup(client, "mallory@example.com")
    assert (
        client.get(
            f"/api/materials/{material['id']}/transcript", headers=other
        ).status_code
        == 404
    )


# ----------------------------------------------------------------------
# Live progress stage
# ----------------------------------------------------------------------

def test_start_extraction_reports_and_clears_the_live_stage(
    client, fake_supabase
) -> None:
    from app.services import extraction_service

    headers = _signup(client, "stage@example.com")
    course = _create_course(client, headers)
    material = _upload_video(client, headers, course["id"])

    # The 202 body is produced by begin_extraction, before the background task
    # runs, so it carries the first stage.
    response = client.post(
        f"/api/materials/{material['id']}/extraction", headers=headers
    )
    assert response.status_code == 202
    assert response.json()["stage"] == "extracting"

    # In tests the background task runs synchronously and always clears it,
    # so a finished material never advertises a live phase.
    assert extraction_service.get_stage(material["id"]) is None

    status = client.get(
        f"/api/materials/{material['id']}/extraction-status", headers=headers
    ).json()
    assert status["stage"] is None
