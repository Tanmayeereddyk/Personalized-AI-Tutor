"""Tests for individual flashcards (ownership, CRUD, deck count)."""

from app.main import app
from tests.conftest import create_user


def _course(client, headers, name="Physics"):
    response = client.post("/api/courses", json={"name": name}, headers=headers)
    assert response.status_code == 201
    return response.json()["id"]


def _deck(client, headers, course_id, topic="Photosynthesis"):
    response = client.post(f"/api/courses/{course_id}/flashcard-decks", json={"topic": topic}, headers=headers)
    assert response.status_code == 201
    return response.json()["id"]


def test_flashcards_crud_and_deck_count(client, logged_in_user):
    user, headers = logged_in_user
    course_id = _course(client, headers)
    deck_id = _deck(client, headers, course_id)
    created = client.post(f"/api/decks/{deck_id}/flashcards", json={"front": "Q1", "back": "A1"}, headers=headers)
    assert created.status_code == 201
    card = created.json()
    assert card["user_id"] == user.id
    deck = client.get(f"/api/flashcard-decks/{deck_id}", headers=headers)
    assert deck.json()["card_count"] == 1
    listed = client.get(f"/api/decks/{deck_id}/flashcards", headers=headers)
    assert listed.status_code == 200
    updated = client.put(f"/api/flashcards/{card["id"]}", json={"front": "Q1b"}, headers=headers)
    assert updated.status_code == 200
    assert client.delete(f"/api/flashcards/{card["id"]}", headers=headers).status_code == 204
    deck2 = client.get(f"/api/flashcard-decks/{deck_id}", headers=headers)
    assert deck2.json()["card_count"] == 0


def test_flashcards_auth_required(client):
    assert client.get("/api/decks/d/flashcards").status_code == 401
    assert client.post("/api/decks/d/flashcards", json={"front":"a","back":"b"}).status_code == 401
    assert client.get("/api/flashcards/c").status_code == 401


def test_cannot_access_another_users_flashcards(client, fake_supabase, logged_in_user):
    _, headers = logged_in_user
    _, other_headers = create_user(fake_supabase, email="other@example.com")
    their_course = client.post("/api/courses", json={"name":"T"}, headers=other_headers).json()["id"]
    their_deck = _deck(client, other_headers, their_course)
    their_card = client.post(f"/api/decks/{their_deck}/flashcards", json={"front":"f","back":"b"}, headers=other_headers).json()
    assert client.get(f"/api/decks/{their_deck}/flashcards", headers=headers).status_code == 404
    assert client.post(f"/api/decks/{their_deck}/flashcards", json={"front":"f","back":"b"}, headers=headers).status_code == 404
    assert client.get(f"/api/flashcards/{their_card["id"]}", headers=headers).status_code == 404
    assert client.put(f"/api/flashcards/{their_card["id"]}", json={"front":"x"}, headers=headers).status_code == 404
    assert client.delete(f"/api/flashcards/{their_card["id"]}", headers=headers).status_code == 404


def test_deck_delete_is_owner_scoped_and_cascades_cards(client, fake_supabase, logged_in_user):
    _, headers = logged_in_user
    course_id = _course(client, headers)
    deck_id = _deck(client, headers, course_id)
    client.post(f"/api/decks/{deck_id}/flashcards", json={"front": "Q", "back": "A"}, headers=headers)
    assert client.delete(f"/api/flashcard-decks/{deck_id}", headers=headers).status_code == 204
    assert client.get(f"/api/flashcard-decks/{deck_id}", headers=headers).status_code == 404
    assert not [card for card in fake_supabase.tables.get("flashcards", []) if card["deck_id"] == deck_id]
