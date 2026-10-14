"""Cleanup for location labels and extraction duplicates in generated notes."""

from app.services.notes_service import clean_generated_notes


def test_removes_slide_and_page_labels_but_keeps_heading_content() -> None:
    markdown = """## Slide 1: Cell Structure

### Page 3 — Organelles

Slide 12

Mitochondria produce ATP. | Slide 12
"""

    cleaned = clean_generated_notes(markdown)

    assert "## Cell Structure" in cleaned
    assert "### Organelles" in cleaned
    assert "Mitochondria produce ATP." in cleaned
    assert "Slide 1" not in cleaned
    assert "Slide 12" not in cleaned
    assert "Page 3" not in cleaned


def test_removes_repeated_headings_and_adjacent_extraction_duplicates() -> None:
    markdown = """## Photosynthesis

Chlorophyll absorbs light.
Chlorophyll absorbs light.

## Photosynthesis

The light reactions produce ATP.
"""

    cleaned = clean_generated_notes(markdown)

    assert cleaned.count("## Photosynthesis") == 1
    assert cleaned.count("Chlorophyll absorbs light.") == 1
    assert "The light reactions produce ATP." in cleaned


def test_preserves_meaningful_numbers_references_and_markdown() -> None:
    markdown = """## Kinematics

1. Use $v = u + at$.
2. For $u = 2$ m/s, $a = 3$ m/s², and $t = 4$ s, $v = 14$ m/s.
The experiment ran on 2024-05-12; refer to page 3 of the student workbook.
This fact is grounded in the source. [#2]

```text
Slide 12 is a value in this example's input string.
```
"""

    cleaned = clean_generated_notes(markdown)

    assert "1. Use $v = u + at$." in cleaned
    assert "2. For $u = 2$ m/s, $a = 3$ m/s², and $t = 4$ s, $v = 14$ m/s." in cleaned
    assert "2024-05-12" in cleaned
    assert "page 3 of the student workbook" in cleaned
    assert "[#2]" in cleaned
    assert "Slide 12 is a value" in cleaned


def test_removes_delimited_trailing_location_but_not_inline_page_reference() -> None:
    markdown = """A = 12 V — Page 8

The procedure continues on page 8 after calibration.
"""

    cleaned = clean_generated_notes(markdown)

    assert "A = 12 V" in cleaned
    assert "Page 8" not in cleaned
    assert "continues on page 8" in cleaned


def test_removes_legacy_trailing_sources_list_when_regenerated() -> None:
    markdown = """# Course Notes

## Key ideas

Energy is conserved.

## Sources
- Chemistry deck
- Physics workbook
"""

    cleaned = clean_generated_notes(markdown)

    assert "Energy is conserved." in cleaned
    assert "## Sources" not in cleaned
    assert "Chemistry deck" not in cleaned
    assert "Physics workbook" not in cleaned
