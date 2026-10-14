"""Tests for AI quiz generation.

Quizzes are generated from the course's *selected topics* by the language model,
grounded in those topics' indexed material content. These tests cover route
registration, authorization, single/multiple-topic generation, the requested
question count, grounding in the selected material, malformed/incomplete model
replies, provider failures, missing topics and empty courses — all offline, using
FakeSupabase and a stubbed model.
"""

import json
import uuid
from datetime import datetime, timezone

from app.main import app
from app.services import llm_service

GENERATE = "/api/courses/{course_id}/quizzes/generate"


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


def _seed_topic(fake, *, user_id, course_id, name, material_ids, description="A topic."):
    row = {
        "id": str(uuid.uuid4()),
        "user_id": user_id,
        "course_id": course_id,
        "name": name,
        "description": description,
        "topic_group": None,
        "prerequisite": None,
        "resource_count": len(material_ids),
        "source_material_ids": list(material_ids),
        "generated": True,
        "generation_method": "llm",
        "created_at": _now(),
        "updated_at": _now(),
    }
    fake.tables.setdefault("topics", []).append(row)
    return row["id"]


def _question_payload(count: int, *, type_cycle=("multiple-choice", "true-false", "short-answer")):
    questions = []
    for i in range(count):
        qtype = type_cycle[i % len(type_cycle)]
        if qtype == "multiple-choice":
            questions.append(
                {
                    "type": "multiple-choice",
                    "prompt": f"Question {i + 1}?",
                    "options": ["Correct option", "Wrong A", "Wrong B"],
                    "correct_answer": "Correct option",
                    "explanation": f"Explanation {i + 1} from the passage.",
                    "source_indexes": [1],
                }
            )
        elif qtype == "true-false":
            questions.append(
                {
                    "type": "true-false",
                    "prompt": f"Question {i + 1}?",
                    "correct_answer": "True",
                    "explanation": f"Explanation {i + 1} from the passage.",
                    "source_indexes": [1],
                }
            )
        else:
            questions.append(
                {
                    "type": "short-answer",
                    "prompt": f"Question {i + 1}?",
                    "correct_answer": "the output",
                    "accepted_answers": ["output"],
                    "explanation": f"Explanation {i + 1} from the passage.",
                    "source_indexes": [1],
                }
            )
    return {"questions": questions}


def _stub_questions(monkeypatch, payload):
    captured: dict = {}

    def fake_complete(system, user, **kwargs):
        captured["system"] = system
        captured["user"] = user
        captured["kwargs"] = kwargs
        return json.dumps(payload) if not isinstance(payload, str) else payload

    monkeypatch.setattr(llm_service, "complete", fake_complete)
    return captured


def _course_with_topic(client, fake, user, headers, *, topic_name="Photosynthesis", contents=None):
    course_id = _course(client, headers)
    material_id = _upload_material(client, headers, course_id)
    _seed_chunks(
        fake,
        user_id=user.id,
        course_id=course_id,
        material_id=material_id,
        contents=contents
        or ["Photosynthesis converts light energy into chemical energy in plants."],
    )
    topic_id = _seed_topic(
        fake, user_id=user.id, course_id=course_id, name=topic_name, material_ids=[material_id]
    )
    return course_id, material_id, topic_id


# ---------------------------------------------------------------
# Routes + auth
# ---------------------------------------------------------------
def test_quiz_generation_route_registered() -> None:
    paths = set(app.openapi()["paths"])
    assert "/api/courses/{course_id}/quizzes/generate" in paths


def test_quiz_generation_requires_authentication(client) -> None:
    assert client.post(GENERATE.format(course_id="some-id"), json={"topic_ids": ["t1"]}).status_code == 401


# ---------------------------------------------------------------
# Generation + grounding
# ---------------------------------------------------------------
def test_generate_from_one_topic_uses_llm_and_content(
    client, fake_supabase, logged_in_user, monkeypatch
) -> None:
    user, headers = logged_in_user
    course_id, _material, topic_id = _course_with_topic(client, fake_supabase, user, headers)
    captured = _stub_questions(monkeypatch, _question_payload(3))

    response = client.post(
        GENERATE.format(course_id=course_id),
        json={"topic_ids": [topic_id], "question_count": 3, "difficulty": "Medium"},
        headers=headers,
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert len(body["questions"]) == 3
    assert body["topic_ids"] == [topic_id]
    assert body["topic_names"] == ["Photosynthesis"]
    # The model really received the selected topic and its indexed content.
    assert "Photosynthesis" in captured["user"]
    assert "Photosynthesis converts light energy" in captured["user"]
    assert captured["kwargs"].get("json_mode") is True
    # Every question has the required fields and a real source.
    for question in body["questions"]:
        assert question["prompt"]
        assert question["explanation"]
        assert question["correct_answer"]
        assert question["source"]["material_name"] == "lecture.pdf"
    mc = next(q for q in body["questions"] if q["type"] == "multiple-choice")
    assert mc["correct_answer"] in mc["options"]
    tf = next(q for q in body["questions"] if q["type"] == "true-false")
    assert tf["correct_answer"] in ("True", "False")


def test_generate_from_multiple_topics(client, fake_supabase, logged_in_user, monkeypatch) -> None:
    user, headers = logged_in_user
    course_id = _course(client, headers)
    material_id = _upload_material(client, headers, course_id)
    _seed_chunks(
        fake_supabase,
        user_id=user.id,
        course_id=course_id,
        material_id=material_id,
        contents=["Photosynthesis stores light energy.", "Cell division copies DNA."],
    )
    topic_a = _seed_topic(
        fake_supabase, user_id=user.id, course_id=course_id, name="Photosynthesis", material_ids=[material_id]
    )
    topic_b = _seed_topic(
        fake_supabase, user_id=user.id, course_id=course_id, name="Cell Division", material_ids=[material_id]
    )
    captured = _stub_questions(monkeypatch, _question_payload(4))

    response = client.post(
        GENERATE.format(course_id=course_id),
        json={"topic_ids": [topic_a, topic_b], "question_count": 4, "difficulty": "Hard"},
        headers=headers,
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert len(body["questions"]) == 4
    assert body["topic_names"] == ["Photosynthesis", "Cell Division"]
    assert "Photosynthesis" in captured["user"] and "Cell Division" in captured["user"]


def test_requested_question_count_is_respected(
    client, fake_supabase, logged_in_user, monkeypatch
) -> None:
    user, headers = logged_in_user
    course_id, _material, topic_id = _course_with_topic(client, fake_supabase, user, headers)
    _stub_questions(monkeypatch, _question_payload(10))

    response = client.post(
        GENERATE.format(course_id=course_id),
        json={"topic_ids": [topic_id], "question_count": 10},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    assert len(response.json()["questions"]) == 10


def test_only_selected_topics_material_is_sent(client, fake_supabase, logged_in_user, monkeypatch) -> None:
    user, headers = logged_in_user
    course_id = _course(client, headers)
    chosen = _upload_material(client, headers, course_id, name="chosen.pdf")
    other = _upload_material(client, headers, course_id, name="other.pdf")
    _seed_chunks(
        fake_supabase, user_id=user.id, course_id=course_id, material_id=chosen,
        contents=["CHOSEN content about mitosis."],
    )
    _seed_chunks(
        fake_supabase, user_id=user.id, course_id=course_id, material_id=other,
        contents=["OTHER unrelated content about poetry."],
    )
    topic_id = _seed_topic(
        fake_supabase, user_id=user.id, course_id=course_id, name="Mitosis", material_ids=[chosen]
    )
    captured = _stub_questions(monkeypatch, _question_payload(2))

    response = client.post(
        GENERATE.format(course_id=course_id),
        json={"topic_ids": [topic_id], "question_count": 2},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    assert "CHOSEN content" in captured["user"]
    assert "OTHER unrelated content" not in captured["user"]


# ---------------------------------------------------------------
# Robust parsing
# ---------------------------------------------------------------
def test_malformed_json_fails_without_fallback(client, fake_supabase, logged_in_user, monkeypatch) -> None:
    user, headers = logged_in_user
    course_id, _material, topic_id = _course_with_topic(client, fake_supabase, user, headers)
    _stub_questions(monkeypatch, "sorry, I cannot do that")

    response = client.post(
        GENERATE.format(course_id=course_id), json={"topic_ids": [topic_id]}, headers=headers
    )
    assert response.status_code == 502
    assert "unreadable" in response.json()["detail"].lower()


def test_incomplete_questions_are_dropped(client, fake_supabase, logged_in_user, monkeypatch) -> None:
    user, headers = logged_in_user
    course_id, _material, topic_id = _course_with_topic(client, fake_supabase, user, headers)
    payload = {
        "questions": [
            {
                "type": "multiple-choice",
                "prompt": "Good question?",
                "options": ["A", "B"],
                "correct_answer": "A",
                "explanation": "Because A.",
                "source_indexes": [1],
            },
            {  # no explanation -> dropped
                "type": "multiple-choice",
                "prompt": "No explanation?",
                "options": ["A", "B"],
                "correct_answer": "A",
                "source_indexes": [1],
            },
            {  # answer not among options -> dropped
                "type": "multiple-choice",
                "prompt": "Bad answer?",
                "options": ["A", "B"],
                "correct_answer": "Z",
                "explanation": "Nope.",
                "source_indexes": [1],
            },
            {  # duplicate prompt -> dropped
                "type": "multiple-choice",
                "prompt": "Good question?",
                "options": ["A", "B"],
                "correct_answer": "A",
                "explanation": "Again.",
                "source_indexes": [1],
            },
        ]
    }
    _stub_questions(monkeypatch, payload)

    response = client.post(
        GENERATE.format(course_id=course_id),
        json={"topic_ids": [topic_id], "question_count": 4},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    questions = response.json()["questions"]
    assert len(questions) == 1
    assert questions[0]["prompt"] == "Good question?"


def test_fenced_json_is_accepted(client, fake_supabase, logged_in_user, monkeypatch) -> None:
    user, headers = logged_in_user
    course_id, _material, topic_id = _course_with_topic(client, fake_supabase, user, headers)
    fenced = "```json\n" + json.dumps(_question_payload(2)) + "\n```"
    _stub_questions(monkeypatch, fenced)

    response = client.post(
        GENERATE.format(course_id=course_id),
        json={"topic_ids": [topic_id], "question_count": 2},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    assert len(response.json()["questions"]) == 2


# ---------------------------------------------------------------
# Error paths
# ---------------------------------------------------------------
def test_provider_error_returns_502(client, fake_supabase, logged_in_user, monkeypatch) -> None:
    user, headers = logged_in_user
    course_id, _material, topic_id = _course_with_topic(client, fake_supabase, user, headers)

    def boom(system, user, **kwargs):
        raise llm_service.LLMError("The provider is down.")

    monkeypatch.setattr(llm_service, "complete", boom)

    response = client.post(
        GENERATE.format(course_id=course_id), json={"topic_ids": [topic_id]}, headers=headers
    )
    assert response.status_code == 502
    assert "provider is down" in response.json()["detail"].lower()


def test_exhausted_retries_surface_the_busy_message(
    client, fake_supabase, logged_in_user, monkeypatch
) -> None:
    """A busy provider (503/429 after retries) returns one clear sentence."""
    user, headers = logged_in_user
    course_id, _material, topic_id = _course_with_topic(client, fake_supabase, user, headers)

    def boom(system, user, **kwargs):
        # This is exactly what llm_service raises once every retry and fallback
        # model has been exhausted by transient failures.
        raise llm_service.LLMError(llm_service.BUSY_MESSAGE)

    monkeypatch.setattr(llm_service, "complete", boom)

    response = client.post(
        GENERATE.format(course_id=course_id), json={"topic_ids": [topic_id]}, headers=headers
    )
    assert response.status_code == 502
    assert response.json()["detail"] == llm_service.BUSY_MESSAGE


def test_exhausted_quota_surfaces_the_quota_message(
    client, fake_supabase, logged_in_user, monkeypatch
) -> None:
    """An exhausted quota is reported specifically, not as "temporarily busy"."""
    user, headers = logged_in_user
    course_id, _material, topic_id = _course_with_topic(client, fake_supabase, user, headers)

    def boom(system, user, **kwargs):
        # Exactly what llm_service raises when a 429 asks to wait far longer
        # than a request can (a free-tier daily quota).
        raise llm_service.LLMError(
            "The quota for the language model gemini (gemini-flash-lite-latest) "
            "is exhausted (HTTP 429). Wait for it to reset, upgrade the plan, or "
            "set LLM_MODEL to a model with available quota — retrying now will not help."
        )

    monkeypatch.setattr(llm_service, "complete", boom)

    response = client.post(
        GENERATE.format(course_id=course_id), json={"topic_ids": [topic_id]}, headers=headers
    )
    assert response.status_code == 502
    detail = response.json()["detail"]
    assert "quota" in detail.lower()
    assert detail != llm_service.BUSY_MESSAGE


def test_unknown_topic_returns_404(client, fake_supabase, logged_in_user, monkeypatch) -> None:
    user, headers = logged_in_user
    course_id, _material, _topic_id = _course_with_topic(client, fake_supabase, user, headers)
    _stub_questions(monkeypatch, _question_payload(2))

    response = client.post(
        GENERATE.format(course_id=course_id),
        json={"topic_ids": [str(uuid.uuid4())]},
        headers=headers,
    )
    assert response.status_code == 404


def test_no_content_returns_400(client, fake_supabase, logged_in_user, monkeypatch) -> None:
    user, headers = logged_in_user
    course_id = _course(client, headers)
    material_id = _upload_material(client, headers, course_id)
    topic_id = _seed_topic(
        fake_supabase, user_id=user.id, course_id=course_id, name="Empty", material_ids=[material_id]
    )
    _stub_questions(monkeypatch, _question_payload(2))

    response = client.post(
        GENERATE.format(course_id=course_id), json={"topic_ids": [topic_id]}, headers=headers
    )
    assert response.status_code == 400


def test_unconfigured_model_returns_503(client, fake_supabase, logged_in_user, monkeypatch) -> None:
    user, headers = logged_in_user
    course_id, _material, topic_id = _course_with_topic(client, fake_supabase, user, headers)
    monkeypatch.setattr(llm_service, "is_configured", lambda: False)

    response = client.post(
        GENERATE.format(course_id=course_id), json={"topic_ids": [topic_id]}, headers=headers
    )
    assert response.status_code == 503


def test_foreign_course_returns_404(client, fake_supabase, logged_in_user, monkeypatch) -> None:
    _user, headers = logged_in_user
    from tests.conftest import create_user

    other_user, other_headers = create_user(fake_supabase, "other@example.com")
    other_course = _course(client, other_headers, name="Other")
    # A topic in another user's course.
    topic_id = _seed_topic(
        fake_supabase, user_id=other_user.id, course_id=other_course, name="Secret", material_ids=[]
    )
    _stub_questions(monkeypatch, _question_payload(2))

    # The first user cannot even see the other's course.
    response = client.post(
        GENERATE.format(course_id=other_course), json={"topic_ids": [topic_id]}, headers=headers
    )
    assert response.status_code == 404
