"""Focused safeguards for AI flashcard duplicate handling."""

from app.services.flashcard_service import _unique, normalize_question


def test_question_normalization_ignores_case_spacing_and_punctuation() -> None:
    assert normalize_question(" What is ATP? ") == normalize_question("what   is ATP!!!")


def test_duplicates_are_removed_across_topic_batches() -> None:
    questions, answers = set(), set()
    first = _unique([{"front": "What is ATP?", "back": "Energy currency"}], questions, answers)
    second = _unique([{"front": "what is ATP!!!", "back": "Energy currency"}], questions, answers)
    assert len(first) == 1
    assert second == []


def test_same_answer_does_not_create_overly_similar_fact_cards() -> None:
    questions, answers = set(), set()
    cards = _unique(
        [
            {"front": "What does ATP provide?", "back": "Cellular energy"},
            {"front": "Which molecule supplies cellular energy?", "back": "cellular energy"},
        ],
        questions,
        answers,
    )
    assert len(cards) == 1
