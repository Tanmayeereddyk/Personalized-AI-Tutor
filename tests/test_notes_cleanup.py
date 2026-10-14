"""Tests for removing source-location metadata from generated notes.

The model is shown each passage as ``[#3] (slides.pdf · Slide 12)``, so it
sometimes copies those location labels into the notes as headings or trailing
tags. :func:`app.services.notes_service.strip_source_location_labels` removes
them — and only them. These tests prove that unwanted "Slide 12" / "Page 3"
labels disappear while meaningful numbers, formulas, numbered steps, tables,
code and grounded prose are preserved exactly.
"""

import uuid
from datetime import datetime, timezone

from app.services import llm_service
from app.services.notes_service import strip_source_location_labels

NOTES_GENERATE = "/api/courses/{course_id}/notes/generate"


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


# ----------------------------------------------------------------------
# Unwanted source-location labels are removed
# ----------------------------------------------------------------------

def test_removes_standalone_slide_and_page_headings() -> None:
    cleaned = strip_source_location_labels(
        "\n".join(
            [
                "## Slide 1",
                "",
                "### Page 3",
                "",
                "**Slide 12**",
                "",
                "- Slide 4:",
                "",
                "Real content about resistance.",
            ]
        )
    )

    assert "Slide 1" not in cleaned
    assert "Page 3" not in cleaned
    assert "Slide 12" not in cleaned
    assert "Slide 4" not in cleaned
    assert "Real content about resistance." in cleaned


def test_removes_repeated_slide_number_headings() -> None:
    cleaned = strip_source_location_labels(
        "\n".join(
            [
                "## Slide 1",
                "",
                "First real point about voltage.",
                "",
                "## Slide 1",
                "",
                "Second real point about current.",
                "",
                "## Slide 2",
            ]
        )
    )

    assert "Slide" not in cleaned
    assert "First real point about voltage." in cleaned
    assert "Second real point about current." in cleaned


def test_strips_a_label_prefix_but_keeps_the_heading_title() -> None:
    cleaned = strip_source_location_labels(
        "\n".join(
            [
                "### Slide 3: Ohm's Law",
                "## Page 12 — Capacitor Charging",
                "Slide 5 - Kirchhoff's Rules",
            ]
        )
    )

    assert cleaned.splitlines() == [
        "### Ohm's Law",
        "## Capacitor Charging",
        "Kirchhoff's Rules",
    ]


def test_removes_wrapped_and_separated_trailing_tags() -> None:
    cleaned = strip_source_location_labels(
        "\n".join(
            [
                "The current through the resistor is 2 A (Slide 6).",
                "Capacitor charging follows an exponential curve — Page 7",
                "Kirchhoff's voltage law holds | Slide 9",
            ]
        )
    )

    assert "Slide" not in cleaned
    assert "Page" not in cleaned
    # Sentence punctuation survives the removal.
    assert "The current through the resistor is 2 A." in cleaned
    assert "Capacitor charging follows an exponential curve" in cleaned
    assert "Kirchhoff's voltage law holds" in cleaned


# ----------------------------------------------------------------------
# Meaningful content is preserved
# ----------------------------------------------------------------------

def test_preserves_numbers_formulas_and_numbered_steps() -> None:
    notes = "\n".join(
        [
            "Ohm's law states that V = IR, with R measured in ohms.",
            "The supply is 12 V and the resistor is 220 ohms.",
            "The experiment ran on 14 October 2026 and took 45 minutes.",
            "",
            "1. Measure the voltage across the resistor.",
            "2. Divide the voltage by the resistance.",
            "3) Record the current to three significant figures.",
            "",
            "1. Slide 12: install the driver",  # a numbered line is never metadata
        ]
    )

    cleaned = strip_source_location_labels(notes)

    assert "V = IR" in cleaned
    assert "12 V" in cleaned
    assert "220 ohms" in cleaned
    assert "2026" in cleaned
    assert "1. Measure the voltage across the resistor." in cleaned
    assert "2. Divide the voltage by the resistance." in cleaned
    assert "3) Record the current to three significant figures." in cleaned
    assert "1. Slide 12: install the driver" in cleaned


def test_preserves_meaningful_prose_mentions_of_page_and_slide() -> None:
    notes = "\n".join(
        [
            "A page fault suspends the process until the page is loaded.",
            "Read page 42 of the manual for the full derivation.",
            "The slide rule multiplies two logarithms mechanically.",
            'The lecturer said "slide 4" covers the same idea.',
        ]
    )

    cleaned = strip_source_location_labels(notes)

    assert cleaned == notes


def test_leaves_code_fences_and_tables_untouched() -> None:
    notes = "\n".join(
        [
            "```python",
            "# Slide 12 is the page marker in this comment",
            "value = 42  # page 3",
            "```",
            "",
            "| Metric | Value |",
            "| --- | --- |",
            "| Page 3 | 12 |",
            "| Page 3 | 12 |",
        ]
    )

    cleaned = strip_source_location_labels(notes)

    assert cleaned == notes


def test_collapses_blank_runs_and_repeated_lines() -> None:
    cleaned = strip_source_location_labels(
        "\n".join(
            [
                "## Key points",
                "",
                "",
                "",
                "- Energy is conserved.",
                "",
                "- Energy is conserved.",
                "",
                "",
                "- Entropy always increases.",
            ]
        )
    )

    assert cleaned.splitlines() == [
        "## Key points",
        "",
        "- Energy is conserved.",
        "",
        "- Entropy always increases.",
    ]


def test_empty_and_label_only_documents_are_handled() -> None:
    assert strip_source_location_labels("") == ""
    assert strip_source_location_labels("## Slide 1").strip() == ""


def test_removes_legacy_trailing_sources_list_on_regeneration() -> None:
    markdown = """# Course Notes

## Key ideas

Energy is conserved.

## Sources
- Chemistry deck
- Physics workbook
"""

    cleaned = strip_source_location_labels(markdown)

    assert "Energy is conserved." in cleaned
    assert "## Sources" not in cleaned
    assert "Chemistry deck" not in cleaned
    assert "Physics workbook" not in cleaned


# ----------------------------------------------------------------------
# End to end: the saved note is cleaned
# ----------------------------------------------------------------------

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
                "page_number": order,
                "chunk_order": order,
                "content": content,
                "embedding": [0.0] * 8,
                "embedding_model": "hashing-512",
                "created_at": _now(),
                "updated_at": _now(),
            }
        )


def test_generated_notes_drop_location_labels_but_keep_technical_content(
    client, fake_supabase, logged_in_user, monkeypatch
) -> None:
    """A full generate call cleans the document the model returns."""
    user, headers = logged_in_user
    course_id = _course(client, headers)
    material_id = _upload_material(client, headers, course_id)
    _seed_chunks(
        fake_supabase,
        user_id=user.id,
        course_id=course_id,
        material_id=material_id,
        contents=["Ohm's law relates voltage, current and resistance."],
    )

    model_reply = "\n".join(
        [
            "## Slide 1",
            "",
            "### Slide 2: Ohm's Law",
            "",
            "Ohm's law states that V = IR, where R is resistance in ohms (Page 3).",
            "",
            "1. Measure the voltage across the resistor.",
            "2. Divide by the resistance to find the current.",
            "",
            "The resistor is 220 ohms and the supply is 12 V (Slide 2).",
            "",
            "## Slide 1",
        ]
    )

    def fake_complete(system, user_prompt, **kwargs):
        return model_reply

    monkeypatch.setattr(llm_service, "complete", fake_complete)

    response = client.post(
        NOTES_GENERATE.format(course_id=course_id),
        json={"material_id": material_id},
        headers=headers,
    )

    assert response.status_code == 201, response.text
    content = response.json()["content"]

    # The unwanted extraction metadata is gone from the saved document.
    assert "Slide 1" not in content
    assert "Slide 2" not in content
    assert "Page 3" not in content
    assert "## Sources" not in content

    # The educational content survived intact.
    assert "### Ohm's Law" in content
    assert "V = IR" in content
    assert "220 ohms" in content
    assert "12 V" in content
    assert "1. Measure the voltage across the resistor." in content
    assert "2. Divide by the resistance to find the current." in content
