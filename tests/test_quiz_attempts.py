"""Tests for persistent, server-graded quiz attempts.

These cover the full submit flow end to end, offline: a generated quiz is
persisted server-side with its answer key, the browser never receives the
answers before submitting, the score is computed on the backend, resubmitting
with the same idempotency token cannot create a duplicate, every submit is its
own history entry, an owner can reopen and delete their attempt, and another
user can never see or grade it.
"""

import uuid

from supabase import PostgrestAPIError

from app.main import app
from tests.conftest import create_user
from tests.test_quiz_generation import (
    _course_with_topic,
    _question_payload,
    _stub_questions,
)

GENERATE = "/api/courses/{course_id}/quizzes/generate"
SUBMIT = "/api/quiz-sets/{set_id}/submit"
RESULT = "/api/quizzes/{attempt_id}/result"
QUIZZES = "/api/courses/{course_id}/quizzes"


def _generate(client, headers, course_id, topic_id, count=3):
    response = client.post(
        GENERATE.format(course_id=course_id),
        json={"topic_ids": [topic_id], "question_count": count, "difficulty": "Medium"},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    return response.json()


# ---------------------------------------------------------------
# Routes + auth
# ---------------------------------------------------------------
def test_quiz_attempt_routes_registered() -> None:
    paths = set(app.openapi()["paths"])
    assert "/api/courses/{course_id}/quizzes/generate" in paths
    assert "/api/quiz-sets/{set_id}" in paths
    assert "/api/quiz-sets/{set_id}/submit" in paths
    assert "/api/quizzes/{item_id}/result" in paths


def test_submit_requires_authentication(client) -> None:
    assert client.post(SUBMIT.format(set_id="x"), json={"answers": []}).status_code == 401
    assert client.get(RESULT.format(attempt_id="x")).status_code == 401


# ---------------------------------------------------------------
# Generation persists the quiz (not an attempt)
# ---------------------------------------------------------------
def test_generate_persists_quiz_without_answers(
    client, fake_supabase, logged_in_user, monkeypatch
) -> None:
    user, headers = logged_in_user
    course_id, _material, topic_id = _course_with_topic(client, fake_supabase, user, headers)
    _stub_questions(monkeypatch, _question_payload(3))

    body = _generate(client, headers, course_id, topic_id)

    assert body["set_id"]
    for question in body["questions"]:
        assert "correct_answer" not in question
        assert "explanation" not in question
    # No completed attempt yet, but the quiz (with its key) is stored.
    assert fake_supabase.tables.get("quizzes", []) == []
    stored = fake_supabase.tables["quiz_sets"]
    assert len(stored) == 1
    assert stored[0]["user_id"] == user.id


# ---------------------------------------------------------------
# Server-side grading
# ---------------------------------------------------------------
def _stored_key(fake_supabase) -> list[dict]:
    return fake_supabase.tables["quiz_sets"][0]["questions"]


def test_submit_grades_on_the_backend(client, fake_supabase, logged_in_user, monkeypatch) -> None:
    user, headers = logged_in_user
    course_id, _material, topic_id = _course_with_topic(client, fake_supabase, user, headers)
    _stub_questions(monkeypatch, _question_payload(3))
    body = _generate(client, headers, course_id, topic_id)

    key = _stored_key(fake_supabase)
    answers = [{"question_id": q["id"], "answer": q["correct_answer"]} for q in key]

    response = client.post(
        SUBMIT.format(set_id=body["set_id"]),
        json={"answers": answers, "time_taken_seconds": 42, "client_token": "tok-1"},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    attempt = response.json()
    assert attempt["score"] == 3
    assert attempt["total"] == 3
    assert attempt["percentage"] == 100
    assert attempt["source"] == "ai"
    assert attempt["submitted_at"]
    # The answer key and explanations are revealed only now.
    assert all(item["correct"] for item in attempt["results"])
    assert attempt["results"][0]["correct_answer"]
    assert attempt["results"][0]["explanation"]


def test_submit_counts_wrong_and_unanswered_as_incorrect(
    client, fake_supabase, logged_in_user, monkeypatch
) -> None:
    user, headers = logged_in_user
    course_id, _material, topic_id = _course_with_topic(client, fake_supabase, user, headers)
    _stub_questions(monkeypatch, _question_payload(3))
    body = _generate(client, headers, course_id, topic_id)

    # Only the first question answered correctly; the rest wrong/blank.
    response = client.post(
        SUBMIT.format(set_id=body["set_id"]),
        json={
            "answers": [
                {"question_id": "q1", "answer": "Correct option"},
                {"question_id": "q2", "answer": "False"},
                {"question_id": "q3", "answer": ""},
            ]
        },
        headers=headers,
    )
    assert response.status_code == 200, response.text
    attempt = response.json()
    assert attempt["score"] == 1
    assert attempt["total"] == 3
    assert attempt["percentage"] == 33
    by_id = {item["id"]: item for item in attempt["results"]}
    assert by_id["q1"]["correct"] is True
    assert by_id["q2"]["correct"] is False
    assert by_id["q3"]["given"] == ""


def test_short_answer_accepts_alternate_spellings(
    client, fake_supabase, logged_in_user, monkeypatch
) -> None:
    user, headers = logged_in_user
    course_id, _material, topic_id = _course_with_topic(client, fake_supabase, user, headers)
    _stub_questions(monkeypatch, _question_payload(1, type_cycle=("short-answer",)))
    body = _generate(client, headers, course_id, topic_id, count=1)

    response = client.post(
        SUBMIT.format(set_id=body["set_id"]),
        json={"answers": [{"question_id": "q1", "answer": "  OUTPUT  "}]},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    assert response.json()["score"] == 1


# ---------------------------------------------------------------
# Idempotency + retakes
# ---------------------------------------------------------------
def test_duplicate_submission_is_idempotent(
    client, fake_supabase, logged_in_user, monkeypatch
) -> None:
    user, headers = logged_in_user
    course_id, _material, topic_id = _course_with_topic(client, fake_supabase, user, headers)
    _stub_questions(monkeypatch, _question_payload(2))
    body = _generate(client, headers, course_id, topic_id)
    key = _stored_key(fake_supabase)
    answers = [{"question_id": q["id"], "answer": q["correct_answer"]} for q in key]
    payload = {"answers": answers, "client_token": "same-token"}

    first = client.post(SUBMIT.format(set_id=body["set_id"]), json=payload, headers=headers)
    second = client.post(SUBMIT.format(set_id=body["set_id"]), json=payload, headers=headers)

    assert first.status_code == 200 and second.status_code == 200
    assert first.json()["id"] == second.json()["id"]
    assert len(fake_supabase.tables["quizzes"]) == 1


def test_retake_creates_a_new_history_entry(
    client, fake_supabase, logged_in_user, monkeypatch
) -> None:
    user, headers = logged_in_user
    course_id, _material, topic_id = _course_with_topic(client, fake_supabase, user, headers)
    _stub_questions(monkeypatch, _question_payload(2))
    body = _generate(client, headers, course_id, topic_id)
    key = _stored_key(fake_supabase)
    answers = [{"question_id": q["id"], "answer": q["correct_answer"]} for q in key]

    client.post(
        SUBMIT.format(set_id=body["set_id"]),
        json={"answers": answers, "client_token": "attempt-1"},
        headers=headers,
    )
    client.post(
        SUBMIT.format(set_id=body["set_id"]),
        json={"answers": [], "client_token": "attempt-2"},
        headers=headers,
    )

    assert len(fake_supabase.tables["quizzes"]) == 2


# ---------------------------------------------------------------
# History: listing, reopening, ownership, deletion
# ---------------------------------------------------------------
def test_attempt_appears_in_history_and_can_be_reopened(
    client, fake_supabase, logged_in_user, monkeypatch
) -> None:
    user, headers = logged_in_user
    course_id, _material, topic_id = _course_with_topic(client, fake_supabase, user, headers)
    _stub_questions(monkeypatch, _question_payload(2))
    body = _generate(client, headers, course_id, topic_id)
    key = _stored_key(fake_supabase)
    answers = [{"question_id": q["id"], "answer": q["correct_answer"]} for q in key]
    attempt_id = client.post(
        SUBMIT.format(set_id=body["set_id"]),
        json={"answers": answers, "client_token": "tok-x"},
        headers=headers,
    ).json()["id"]

    listing = client.get(QUIZZES.format(course_id=course_id), headers=headers)
    assert listing.status_code == 200, listing.text
    rows = listing.json()
    assert [row["id"] for row in rows] == [attempt_id]
    assert rows[0]["percentage"] == 100
    assert rows[0]["source"] == "ai"

    reopened = client.get(RESULT.format(attempt_id=attempt_id), headers=headers)
    assert reopened.status_code == 200, reopened.text
    detail = reopened.json()
    assert detail["id"] == attempt_id
    assert len(detail["results"]) == 2
    assert all(item["correct_answer"] for item in detail["results"])


def test_another_user_cannot_submit_or_reopen(
    client, fake_supabase, logged_in_user, monkeypatch
) -> None:
    user, headers = logged_in_user
    course_id, _material, topic_id = _course_with_topic(client, fake_supabase, user, headers)
    _stub_questions(monkeypatch, _question_payload(2))
    body = _generate(client, headers, course_id, topic_id)
    key = _stored_key(fake_supabase)
    answers = [{"question_id": q["id"], "answer": q["correct_answer"]} for q in key]
    attempt_id = client.post(
        SUBMIT.format(set_id=body["set_id"]),
        json={"answers": answers, "client_token": "tok-owner"},
        headers=headers,
    ).json()["id"]

    _other, other_headers = create_user(fake_supabase, "other@example.com")

    # The other user cannot submit against a quiz they do not own…
    assert (
        client.post(
            SUBMIT.format(set_id=body["set_id"]),
            json={"answers": []},
            headers=other_headers,
        ).status_code
        == 404
    )
    # …nor read the owner's attempt.
    assert client.get(RESULT.format(attempt_id=attempt_id), headers=other_headers).status_code == 404


def test_deleting_an_attempt_keeps_the_quiz_and_materials(
    client, fake_supabase, logged_in_user, monkeypatch
) -> None:
    user, headers = logged_in_user
    course_id, material_id, topic_id = _course_with_topic(
        client, fake_supabase, user, headers
    )
    _stub_questions(monkeypatch, _question_payload(2))
    body = _generate(client, headers, course_id, topic_id)
    key = _stored_key(fake_supabase)
    answers = [{"question_id": q["id"], "answer": q["correct_answer"]} for q in key]
    attempt_id = client.post(
        SUBMIT.format(set_id=body["set_id"]),
        json={"answers": answers, "client_token": "tok-del"},
        headers=headers,
    ).json()["id"]

    deleted = client.delete(f"/api/quizzes/{attempt_id}", headers=headers)
    assert deleted.status_code == 204, deleted.text

    assert fake_supabase.tables["quizzes"] == []
    # The generated quiz (answer key), its source material and topic survive.
    assert len(fake_supabase.tables["quiz_sets"]) == 1
    assert any(row["id"] == material_id for row in fake_supabase.tables["materials"])
    assert any(row["id"] == topic_id for row in fake_supabase.tables["topics"])


def test_submit_unknown_quiz_is_404(client, fake_supabase, logged_in_user) -> None:
    _user, headers = logged_in_user
    response = client.post(
        SUBMIT.format(set_id=str(uuid.uuid4())),
        json={"answers": []},
        headers=headers,
    )
    assert response.status_code == 404


# ---------------------------------------------------------------
# Missing-migration diagnostics
# ---------------------------------------------------------------
def test_generate_without_quiz_sets_table_explains_the_migration(
    client, fake_supabase, logged_in_user, monkeypatch
) -> None:
    """Before migration 007 the error must name the table and the fix."""
    user, headers = logged_in_user
    course_id, _material, topic_id = _course_with_topic(client, fake_supabase, user, headers)
    _stub_questions(monkeypatch, _question_payload(3))
    fake_supabase.table_errors["quiz_sets"] = PostgrestAPIError(
        {
            "message": "Could not find the table 'public.quiz_sets' in the schema cache",
            "code": "PGRST205",
            "details": "",
            "hint": "",
        }
    )

    response = client.post(
        GENERATE.format(course_id=course_id),
        json={"topic_ids": [topic_id], "question_count": 3, "difficulty": "Medium"},
        headers=headers,
    )

    assert response.status_code == 500
    detail = response.json()["detail"]
    # Names the missing table and points at the migrations, not just schema.sql.
    assert "quiz_sets" in detail
    assert "database/migrations/" in detail


def test_submit_without_quizzes_columns_explains_the_migration(
    client, fake_supabase, logged_in_user, monkeypatch
) -> None:
    user, headers = logged_in_user
    course_id, _material, topic_id = _course_with_topic(client, fake_supabase, user, headers)
    _stub_questions(monkeypatch, _question_payload(3))
    body = _generate(client, headers, course_id, topic_id)
    # The new attempt columns are missing (migration 007 not applied).
    fake_supabase.table_errors["quizzes"] = PostgrestAPIError(
        {
            "message": "column quizzes.results does not exist",
            "code": "42703",
            "details": "",
            "hint": "",
        }
    )

    response = client.post(
        SUBMIT.format(set_id=body["set_id"]),
        json={"answers": [], "client_token": "tok-missing-col"},
        headers=headers,
    )

    assert response.status_code == 500
    assert "database/migrations/" in response.json()["detail"]
