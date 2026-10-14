"""Tests for the course knowledge map (topics).

Topics are generated from a course's own indexed RAG chunks by the language
model, then persisted and de-duplicated. These tests cover route registration,
authorization, generation, persistence, duplicate prevention, refresh, empty
courses and model failures — all offline, using FakeSupabase and a stubbed model.
"""

import json
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.main import app
from app.services import extraction_service, extractors, llm_service, rag_service, topic_service
from tests.conftest import create_user


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _course(client, headers, name="Physics") -> str:
    response = client.post("/api/courses", json={"name": name}, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _upload_material(client, headers, course_id, name="lecture.pdf") -> str:
    response = client.post(
        f"/api/courses/{course_id}/materials",
        files=[("files", (name, b"pdf-bytes", "application/pdf"))],
        headers=headers,
    )
    assert response.status_code == 201, response.text
    return response.json()[0]["id"]


def _seed_chunks(fake, *, user_id, course_id, material_id, contents) -> None:
    """Put indexed chunks into the fake RAG table (as indexing would)."""
    rows = fake.tables.setdefault("rag_chunks", [])
    for order, content in enumerate(contents, start=1):
        rows.append(
            {
                "id": str(uuid.uuid4()),
                "user_id": user_id,
                "material_id": material_id,
                "course_id": course_id,
                "source_type": "pdf",
                "chunk_order": order,
                "content": content,
                "embedding": [0.0] * 8,
                "embedding_model": "hashing-512",
                "created_at": _now(),
                "updated_at": _now(),
            }
        )


def _course_with_indexed_material(client, fake, user, headers):
    """A course + one indexed material; returns (course_id, material_id)."""
    course_id = _course(client, headers)
    material_id = _upload_material(client, headers, course_id)
    _seed_chunks(
        fake,
        user_id=user.id,
        course_id=course_id,
        material_id=material_id,
        contents=[
            "Photosynthesis converts light energy into chemical energy in plants.",
            "Cell division lets one cell become two identical daughter cells.",
        ],
    )
    return course_id, material_id


def _stub_topics(monkeypatch, entries) -> None:
    monkeypatch.setattr(
        llm_service, "complete", lambda system, user, **kwargs: json.dumps(entries)
    )


# ---------------------------------------------------------------
# Routes registered
# ---------------------------------------------------------------
def test_topics_routes_registered() -> None:
    paths = set(app.openapi()["paths"])
    expected = {
        "/api/courses/{course_id}/topics",
        "/api/courses/{course_id}/topics/generate",
        "/api/courses/{course_id}/topics/refresh",
        "/api/topics/{topic_id}",
    }
    assert not (expected - paths), f"routes missing: {expected - paths}"


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/api/courses/some-id/topics"),
        ("POST", "/api/courses/some-id/topics/generate"),
        ("POST", "/api/courses/some-id/topics/refresh"),
        ("GET", "/api/topics/topic-1"),
    ],
)
def test_topics_endpoints_require_authentication(client, method, path) -> None:
    assert client.request(method, path).status_code == 401


# ---------------------------------------------------------------
# Generation + persistence
# ---------------------------------------------------------------
def test_generate_persists_topics_and_lists_them(
    client, fake_supabase, logged_in_user, monkeypatch
) -> None:
    user, headers = logged_in_user
    course_id, _material_id = _course_with_indexed_material(
        client, fake_supabase, user, headers
    )
    _stub_topics(
        monkeypatch,
        [
            {"name": "Photosynthesis", "description": "How plants make food.",
             "topic_group": "Biology"},
            {"name": "Cell Division", "description": "How cells multiply.",
             "topic_group": "Biology"},
        ],
    )

    response = client.post(
        f"/api/courses/{course_id}/topics/generate", headers=headers
    )
    assert response.status_code == 201, response.text
    assert [t["name"] for t in response.json()] == ["Cell Division", "Photosynthesis"]

    listed = client.get(f"/api/courses/{course_id}/topics", headers=headers)
    assert listed.status_code == 200
    rows = listed.json()
    assert {t["name"] for t in rows} == {"Photosynthesis", "Cell Division"}
    photosynthesis = next(t for t in rows if t["name"] == "Photosynthesis")
    assert photosynthesis["description"] == "How plants make food."
    assert photosynthesis["topic_group"] == "Biology"
    assert photosynthesis["generated"] is True
    assert photosynthesis["generation_method"] == "llm"
    # Grounded resource count: the name appears in the seeded passage.
    assert photosynthesis["resource_count"] == 1
    assert photosynthesis["source_material_ids"]

    single = client.get(f"/api/topics/{photosynthesis['id']}", headers=headers)
    assert single.status_code == 200
    assert single.json()["id"] == photosynthesis["id"]


def test_generate_prevents_duplicates_on_repeat(
    client, fake_supabase, logged_in_user, monkeypatch
) -> None:
    user, headers = logged_in_user
    course_id, _ = _course_with_indexed_material(client, fake_supabase, user, headers)
    _stub_topics(
        monkeypatch,
        [{"name": "Photosynthesis", "description": "First pass."}],
    )

    first = client.post(f"/api/courses/{course_id}/topics/generate", headers=headers)
    second = client.post(f"/api/courses/{course_id}/topics/generate", headers=headers)
    assert first.status_code == second.status_code == 201

    assert len(fake_supabase.tables["topics"]) == 1
    assert first.json()[0]["id"] == second.json()[0]["id"]


def test_refresh_updates_adds_and_removes_generated_topics(
    client, fake_supabase, logged_in_user, monkeypatch
) -> None:
    user, headers = logged_in_user
    course_id, _ = _course_with_indexed_material(client, fake_supabase, user, headers)

    # A hand-written topic must survive every refresh.
    fake_supabase.tables.setdefault("topics", []).append(
        {
            "id": str(uuid.uuid4()),
            "user_id": user.id,
            "course_id": course_id,
            "name": "Manual Note",
            "generated": False,
            "resource_count": 0,
            "created_at": _now(),
            "updated_at": _now(),
        }
    )

    _stub_topics(
        monkeypatch,
        [
            {"name": "Photosynthesis", "description": "Old description."},
            {"name": "Cell Division", "description": "Cells multiply."},
        ],
    )
    client.post(f"/api/courses/{course_id}/topics/generate", headers=headers)
    old_photo = next(
        t for t in fake_supabase.tables["topics"] if t["name"] == "Photosynthesis"
    )

    _stub_topics(
        monkeypatch,
        [
            {"name": "Photosynthesis", "description": "Updated description."},
            {"name": "Genetics", "description": "Inheritance of traits."},
        ],
    )
    refreshed = client.post(
        f"/api/courses/{course_id}/topics/refresh", headers=headers
    )
    assert refreshed.status_code == 200

    # The endpoint returns the freshly generated topics...
    names = {t["name"] for t in refreshed.json()}
    assert names == {"Photosynthesis", "Genetics"}
    photo = next(t for t in refreshed.json() if t["name"] == "Photosynthesis")
    assert photo["description"] == "Updated description."
    assert photo["id"] == old_photo["id"]
    assert "Cell Division" not in names

    # ...while the hand-written topic survives and is still listed.
    stored = {t["name"] for t in fake_supabase.tables["topics"]}
    assert "Manual Note" in stored
    listed = client.get(f"/api/courses/{course_id}/topics", headers=headers).json()
    assert "Manual Note" in {t["name"] for t in listed}


# ---------------------------------------------------------------
# Empty / unindexed courses
# ---------------------------------------------------------------
def test_generate_on_empty_course_is_graceful(
    client, logged_in_user, monkeypatch
) -> None:
    _user, headers = logged_in_user
    course_id = _course(client, headers)

    response = client.post(
        f"/api/courses/{course_id}/topics/generate", headers=headers
    )
    assert response.status_code == 400
    assert "add materials" in response.json()["detail"].lower()


def test_generate_without_processed_content_is_graceful(
    client, logged_in_user, monkeypatch
) -> None:
    _user, headers = logged_in_user
    course_id = _course(client, headers)
    _upload_material(client, headers, course_id)

    response = client.post(
        f"/api/courses/{course_id}/topics/generate", headers=headers
    )
    assert response.status_code == 400
    assert "processing" in response.json()["detail"].lower()


# ---------------------------------------------------------------
# Failures
# ---------------------------------------------------------------
def test_generate_returns_503_when_model_not_configured(
    client, fake_supabase, logged_in_user, monkeypatch
) -> None:
    user, headers = logged_in_user
    course_id, _ = _course_with_indexed_material(client, fake_supabase, user, headers)
    monkeypatch.setattr(llm_service, "is_configured", lambda: False)

    response = client.post(
        f"/api/courses/{course_id}/topics/generate", headers=headers
    )
    assert response.status_code == 503


def test_generate_returns_502_for_unreadable_model_output(
    client, fake_supabase, logged_in_user, monkeypatch
) -> None:
    user, headers = logged_in_user
    course_id, _ = _course_with_indexed_material(client, fake_supabase, user, headers)
    monkeypatch.setattr(
        llm_service, "complete", lambda system, user, **kwargs: "not json at all"
    )

    response = client.post(
        f"/api/courses/{course_id}/topics/generate", headers=headers
    )
    assert response.status_code == 502


# ---------------------------------------------------------------
# Authorization
# ---------------------------------------------------------------
def test_other_users_topics_are_hidden(client, fake_supabase, logged_in_user) -> None:
    _user, headers = logged_in_user
    other, other_headers = create_user(fake_supabase, email="other@example.com")
    their_course = _course(client, other_headers, name="Theirs")

    fake_supabase.tables.setdefault("topics", []).append(
        {
            "id": str(uuid.uuid4()),
            "user_id": other.id,
            "course_id": their_course,
            "name": "Their Topic",
            "generated": True,
        }
    )
    their_topic_id = fake_supabase.tables["topics"][0]["id"]

    assert (
        client.get(f"/api/topics/{their_topic_id}", headers=headers).status_code
        == 404
    )
    assert (
        client.get(
            f"/api/courses/{their_course}/topics", headers=headers
        ).status_code
        == 404
    )
    assert (
        client.post(
            f"/api/courses/{their_course}/topics/generate", headers=headers
        ).status_code
        == 404
    )


# ---------------------------------------------------------------
# Robust parsing of real-world model output
# ---------------------------------------------------------------
_TWO_TOPICS_JSON = '[{"name": "Photosynthesis", "description": "d", "topic_group": "Biology"}]'


@pytest.mark.parametrize(
    "raw",
    [
        # The happy path: a strict JSON object.
        '{"topics": ' + _TWO_TOPICS_JSON + "}",
        # A bare array (older prompt shape).
        _TWO_TOPICS_JSON,
        # Wrapped in a Markdown code fence.
        "```json\n" + _TWO_TOPICS_JSON + "\n```",
        # Prose / citations before the payload (the first "[" is a citation).
        "Based on passages [1][2], here are the topics:\n" + _TWO_TOPICS_JSON,
        # Prose after the payload.
        _TWO_TOPICS_JSON + "\n\nLet me know if you want more detail.",
        # A literal newline inside a string (invalid JSON as written).
        '[{"name": "Photosynthesis", "description": "line one\nline two"}]',
        # A trailing comma.
        '[{"name": "Photosynthesis", "description": "d",},]',
        # Python-style single quotes.
        "[{'name': 'Photosynthesis', 'description': 'd'}]",
        # Truncated mid-string because the token budget ran out.
        '[{"name": "Photosynthesis", "description": "trunca',
    ],
)
def test_parse_entries_handles_real_world_shapes(raw: str) -> None:
    entries = topic_service._parse_entries(raw)
    assert [entry["name"] for entry in entries] == ["Photosynthesis"]
    assert all("{" not in entry["name"] for entry in entries)


def test_parse_entries_rejects_non_topic_output() -> None:
    with pytest.raises(HTTPException) as excinfo:
        topic_service._parse_entries("not json at all")
    assert excinfo.value.status_code == 502
    # And an empty reply is a clear failure, never a silent "no topics".
    with pytest.raises(HTTPException):
        topic_service._parse_entries("")


def test_parse_entries_never_returns_raw_text_as_topics() -> None:
    # A JSON list of numbers is valid JSON but not topics — reject it.
    with pytest.raises(HTTPException):
        topic_service._parse_entries("[1, 2, 3]")


def test_topic_source_material_ids_follow_cited_passages(
    client, fake_supabase, logged_in_user, monkeypatch
) -> None:
    user, headers = logged_in_user
    course_id = _course(client, headers)
    first = _upload_material(client, headers, course_id, name="first.pdf")
    second = _upload_material(client, headers, course_id, name="second.pdf")
    _seed_chunks(
        fake_supabase, user_id=user.id, course_id=course_id, material_id=first,
        contents=["Photosynthesis converts light to chemical energy."],
    )
    _seed_chunks(
        fake_supabase, user_id=user.id, course_id=course_id, material_id=second,
        contents=["Cell division produces two daughter cells."],
    )

    # The model cites passage #1 (first.pdf) for the topic it generated.
    monkeypatch.setattr(
        llm_service,
        "complete",
        lambda system, user, **kwargs: json.dumps(
            {"topics": [{"name": "Photosynthesis", "source_indexes": [1]}]}
        ),
    )

    response = client.post(
        f"/api/courses/{course_id}/topics/generate", headers=headers
    )
    assert response.status_code == 201, response.text
    topic = response.json()[0]
    assert topic["source_material_ids"] == [first]


def test_generation_is_rejected_while_one_is_already_running() -> None:
    key = topic_service._begin_generation("guard-user", "guard-course")
    try:
        with pytest.raises(HTTPException) as excinfo:
            topic_service._begin_generation("guard-user", "guard-course")
        assert excinfo.value.status_code == 409
    finally:
        topic_service._end_generation(key)
    # The slot is released afterwards, so a later click succeeds.
    topic_service._end_generation(
        topic_service._begin_generation("guard-user", "guard-course")
    )


# ---------------------------------------------------------------
# Auto-refresh after extraction
# ---------------------------------------------------------------
def test_extraction_refreshes_course_topics(
    client, fake_supabase, logged_in_user, monkeypatch
) -> None:
    user, headers = logged_in_user
    course_id = _course(client, headers)
    material_id = _upload_material(client, headers, course_id)

    monkeypatch.setattr(
        extractors, "download_material", lambda client, material: b"data"
    )
    monkeypatch.setattr(
        extractors,
        "run_extractor",
        lambda client, material, content, on_stage=None: SimpleNamespace(
            units=[
                {
                    "content_type": "text",
                    "content": "Photosynthesis converts light to chemical energy.",
                    "unit_order": 1,
                }
            ],
            warnings=[],
        ),
    )
    monkeypatch.setattr(extractors, "summary_unit", lambda material, warnings: None)
    monkeypatch.setattr(
        rag_service,
        "index_material",
        lambda client, user_id, material_id: {"material_id": material_id},
    )

    refreshed: list[str] = []
    monkeypatch.setattr(
        topic_service,
        "generate_topics",
        lambda client, user_id, cid: refreshed.append(cid) or [],
    )

    extraction_service.run_extraction(fake_supabase, user.id, material_id)

    assert refreshed == [course_id]
