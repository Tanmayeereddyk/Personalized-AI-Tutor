"""Topic-isolated, source-grounded flashcard generation.

The generator deliberately works one topic at a time.  The old implementation
was absent from source (only a stale bytecode cache remained), so there was no
route enforcing topic provenance or deduplicating model output.  This service
uses the existing RAG store and LLM client, validates JSON, keeps valid cards
when a retry is needed, and persists only rows owned by the current user.
"""
from __future__ import annotations

import re
from fastapi import HTTPException
from supabase import Client

from app.services import llm_service, owned_service, rag_service, topic_service

MAX_RETRIES = 2
_SPACE = re.compile(r"\s+")
_PUNCT = re.compile(r"[^\w\s]", re.UNICODE)

SYSTEM = """You create concise study flashcards using ONLY the supplied source passages.
Return exactly one JSON object: {"cards":[{"question":"...","answer":"..."}]}.
Each question must be specific, answerable from the passages, and unique. Do not use
outside knowledge, vague prompts, repeated questions, or several questions with the
same answer. If the passages cannot support enough cards, return fewer cards."""


def normalize_question(value: object) -> str:
    """Comparison key that ignores case, whitespace and minor punctuation."""
    text = _PUNCT.sub(" ", str(value or "").casefold())
    return _SPACE.sub(" ", text).strip()


def _parse(raw: str, limit: int) -> list[dict]:
    for candidate in topic_service._json_candidates((raw or "").strip()):
        try:
            data = topic_service._loads(candidate)
        except ValueError:
            continue
        rows = data.get("cards", data.get("flashcards", [])) if isinstance(data, dict) else data
        if not isinstance(rows, list):
            continue
        cards = []
        for row in rows:
            if not isinstance(row, dict):
                continue
            question = str(row.get("question") or row.get("front") or "").strip()
            answer = str(row.get("answer") or row.get("back") or "").strip()
            if question and answer and len(question) <= 4000 and len(answer) <= 4000:
                cards.append({"front": question, "back": answer})
            if len(cards) >= limit:
                break
        return cards
    return []


def _topic_chunks(client: Client, user_id: str, course_id: str, topic: dict) -> list[dict]:
    ids = {str(x) for x in (topic.get("source_material_ids") or []) if x}
    if not ids:
        return []  # no provenance: do not silently use unrelated course material
    chunks = rag_service.list_chunks(client, user_id, course_id=course_id)
    if not chunks:
        for material_id in ids:
            rag_service.ensure_material_indexed(client, user_id, material_id)
        chunks = rag_service.list_chunks(client, user_id, course_id=course_id)
    return [row for row in chunks if str(row.get("material_id")) in ids and (row.get("content") or "").strip()]


def _source(chunks: list[dict]) -> str:
    budget, used, blocks = 12000, 0, []
    for index, chunk in enumerate(chunks, 1):
        block = f"[#{index}]\n{str(chunk.get('content') or '').strip()}"
        if used and used + len(block) > budget:
            break
        blocks.append(block)
        used += len(block)
    return "\n\n".join(blocks)


def _unique(cards: list[dict], seen_questions: set[str], seen_answers: set[str]) -> list[dict]:
    valid = []
    for card in cards:
        question, answer = normalize_question(card["front"]), normalize_question(card["back"])
        # Same answer is allowed only once across this generated deck. This avoids
        # near-identical prompts that merely rephrase the same fact.
        if not question or question in seen_questions or answer in seen_answers:
            continue
        seen_questions.add(question)
        seen_answers.add(answer)
        valid.append(card)
    return valid


def generate_deck(client: Client, user_id: str, course_id: str, *, deck_name: str, topic_ids: list[str], cards_per_topic: int, difficulty: str) -> dict:
    owned_service.ensure_course_owned(client, user_id, course_id)
    if not llm_service.is_configured():
        raise HTTPException(status_code=503, detail=llm_service.not_configured_message())
    all_topics = {row["id"]: row for row in owned_service.list_items(client, user_id, "topics", course_id=course_id)}
    selected, seen_ids = [], set()
    for topic_id in topic_ids:
        if topic_id not in all_topics:
            raise HTTPException(status_code=404, detail="One or more selected topics were not found in this course.")
        if topic_id not in seen_ids:
            selected.append(all_topics[topic_id]); seen_ids.add(topic_id)

    deck = owned_service.create_item(client, user_id, "flashcard_decks", {
        "course_id": course_id, "name": deck_name.strip(),
        "topic": selected[0]["name"] if len(selected) == 1 else "Multiple topics", "card_count": 0,
    })
    all_cards, results, seen_questions, seen_answers = [], [], set(), set()
    for topic in selected:
        source = _source(_topic_chunks(client, user_id, course_id, topic))
        requested = cards_per_topic
        cards: list[dict] = []
        message = None
        if not source:
            message = "Source material for this topic is unavailable; no cards were generated."
        else:
            for attempt in range(MAX_RETRIES + 1):
                missing = requested - len(cards)
                if missing <= 0:
                    break
                prompt = (f"Topic: {topic['name']}\nDifficulty: {difficulty}\nCreate exactly {missing} new flashcards. "
                          f"Avoid these existing questions: {[card['front'] for card in cards]}.\n\nSource passages:\n{source}")
                try:
                    raw = llm_service.complete(SYSTEM, prompt, max_tokens=min(4096, 300 + missing * 180), json_mode=True)
                except llm_service.LLMError as exc:
                    if not cards:
                        message = f"Generation failed: {exc}"
                    break
                candidates = _parse(raw, missing)
                cards.extend(_unique(candidates, seen_questions, seen_answers))
            if len(cards) < requested:
                message = f"Generated {len(cards)} of {requested} unique cards; this topic needs fewer cards or more source material."
        for card in cards:
            row = owned_service.create_item(client, user_id, "flashcards", {**card, "deck_id": deck["id"], "topic_id": topic["id"], "topic": topic["name"]})
            all_cards.append(row)
        results.append({"topic_id": topic["id"], "topic": topic["name"], "requested": requested, "generated": len(cards), "message": message})
    owned_service.update_deck_card_count(client, user_id, deck["id"])
    deck = owned_service.get_item(client, user_id, "flashcard_decks", deck["id"])
    failures = [f"{item['topic']}: {item['generated']}/{item['requested']}" for item in results if item['generated'] < item['requested']]
    return {"deck": deck, "cards": all_cards, "topics": results, "message": "Some topics had limited source support: " + "; ".join(failures) if failures else None}
