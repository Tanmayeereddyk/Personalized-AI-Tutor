"""Render generated notes as a real PDF document.

The Markdown notes are laid out into a paginated A4 document with headings,
body text, bullet/numbered lists, code blocks, block quotes, tables and page
numbers. The canonical notes stay in the ``notes.content`` Markdown column, so a
PDF is regenerated on demand whenever the notes change.

Rendering uses PyMuPDF (``fitz``), which the project already uses for PDF
extraction. If it is not installed, :class:`PdfUnavailable` is raised and the API
reports a clear 503 instead of pretending a PDF exists.
"""

from __future__ import annotations

import re

try:  # PyMuPDF is an optional extraction engine; notes-PDF needs it too.
    import fitz  # type: ignore
except Exception:  # pragma: no cover - exercised only when fitz is missing
    fitz = None


class PdfUnavailable(RuntimeError):
    """Raised when the PDF engine is not installed."""


# A4 with sane margins (1 pt = 1/72 inch).
_PAGE_WIDTH = 595.0
_PAGE_HEIGHT = 842.0
_MARGIN_X = 56.0
_MARGIN_TOP = 64.0
_MARGIN_BOTTOM = 60.0
_FOOTER_HEIGHT = 26.0
_CONTENT_W = _PAGE_WIDTH - 2 * _MARGIN_X
_LINE_GAP = 1.38

_INK = (0.12, 0.13, 0.16)
_MUTED = (0.42, 0.45, 0.50)
_RULE = (0.80, 0.82, 0.86)

_HEADINGS = {
    1: ("hebo", 20.0),
    2: ("hebo", 14.5),
    3: ("hebo", 12.0),
    4: ("hebo", 10.8),
    5: ("hebo", 10.4),
    6: ("hebo", 10.2),
}

# Characters the built-in PDF fonts (WinAnsi) cannot encode, mapped to readable
# ASCII. Anything still unencodable is replaced with "?".
_TRANSLITERATION = {
    "α": "alpha", "β": "beta", "γ": "gamma", "δ": "delta", "ε": "epsilon",
    "ζ": "zeta", "η": "eta", "θ": "theta", "ι": "iota", "κ": "kappa",
    "λ": "lambda", "μ": "mu", "ν": "nu", "ξ": "xi", "π": "pi", "ρ": "rho",
    "σ": "sigma", "ς": "sigma", "τ": "tau", "υ": "upsilon", "φ": "phi",
    "χ": "chi", "ψ": "psi", "ω": "omega", "Γ": "Gamma", "Δ": "Delta",
    "Θ": "Theta", "Λ": "Lambda", "Ξ": "Xi", "Π": "Pi", "Σ": "Sigma",
    "Φ": "Phi", "Ψ": "Psi", "Ω": "Omega",
    "∫": "integral", "∮": "contour integral", "∑": "sum", "∏": "product",
    "√": "sqrt", "∞": "infinity", "≈": "~=", "≠": "!=", "≤": "<=", "≥": ">=",
    "→": "->", "←": "<-", "↔": "<->", "⇒": "=>", "⇔": "<=>", "∂": "d",
    "∈": "in", "∉": "not in", "⊂": "subset", "∪": "union", "∩": "intersect",
    "⋅": "*", "·": "*", "×": "x", "÷": "/", "±": "+/-", "∓": "-/+",
    "°": "deg", "‰": "0/00", "∝": "proportional to", "∅": "empty set",
    "∇": "grad", "≡": "===", "≅": "~=", "∼": "~", "⇒": "=>",
    "“": '"', "”": '"', "‘": "'", "’": "'", "—": "-", "–": "-", "−": "-",
    "…": "...", "•": "-", "™": "(TM)", "→": "->", "\u00a0": " ",
    "¹": "^1", "²": "^2", "³": "^3", "⁰": "^0", "⁴": "^4", "⁵": "^5",
    "₀": "_0", "₁": "_1", "₂": "_2", "₃": "_3",
}

# Same table keyed by code point, which is what ``str.translate`` needs.
_TRANSLITERATION_ORD = {ord(char): replacement for char, replacement in _TRANSLITERATION.items()}


def available() -> bool:
    """True when the PDF engine can be used."""
    return fitz is not None


def _safe(text: str) -> str:
    """Make text encodable by the built-in PDF fonts."""
    # ``str.translate`` looks characters up by ordinal, so the table's character
    # keys must be converted to code points first — otherwise nothing is replaced
    # and every non-Latin-1 glyph (em dash, Greek, math symbols) becomes "?".
    text = text.translate(_TRANSLITERATION_ORD)
    return text.encode("latin-1", "replace").decode("latin-1")


def _strip_inline(text: str) -> str:
    """Remove lightweight Markdown emphasis/links, keeping readable text."""
    text = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r"\1 (\2)", text)
    text = text.replace("**", "").replace("__", "")
    text = re.sub(r"(?<![\w*])[*_]([^*_]+)[*_](?![\w*])", r"\1", text)
    text = text.replace("`", "").replace("$", "")
    return text.strip()


# ----------------------------------------------------------------------
# Markdown block parsing
# ----------------------------------------------------------------------

_HEADING_RE = re.compile(r"^(#{1,6})\s+(.*)$")
_BULLET_RE = re.compile(r"^(\s*)[-*+]\s+(.*)$")
_ORDERED_RE = re.compile(r"^(\s*)\d+[.)]\s+(.*)$")
_QUOTE_RE = re.compile(r"^>\s?(.*)$")
_HR_RE = re.compile(r"^\s*([-*_])(?:\s*\1){2,}\s*$")
_TABLE_ROW_RE = re.compile(r"^\s*\|.*\|\s*$")
_TABLE_SEP_RE = re.compile(r"^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$")


def _parse_blocks(markdown: str) -> list[dict]:
    lines = (markdown or "").replace("\r\n", "\n").replace("\r", "\n").split("\n")
    blocks: list[dict] = []
    index = 0
    while index < len(lines):
        line = lines[index]
        stripped = line.strip()

        if stripped.startswith("```"):
            index += 1
            code: list[str] = []
            while index < len(lines) and not lines[index].strip().startswith("```"):
                code.append(lines[index])
                index += 1
            index += 1  # closing fence
            blocks.append({"type": "code", "text": "\n".join(code)})
            continue

        heading = _HEADING_RE.match(stripped)
        if heading:
            blocks.append(
                {"type": "heading", "level": len(heading.group(1)), "text": heading.group(2).strip()}
            )
            index += 1
            continue

        if _HR_RE.match(line):
            blocks.append({"type": "hr"})
            index += 1
            continue

        if _TABLE_ROW_RE.match(line):
            raw_rows: list[str] = []
            while index < len(lines) and _TABLE_ROW_RE.match(lines[index]):
                if not _TABLE_SEP_RE.match(lines[index]):
                    raw_rows.append(lines[index])
                index += 1
            rows = [_split_table_row(raw) for raw in raw_rows]
            if rows:
                blocks.append({"type": "table", "rows": rows})
            continue

        bullet = _BULLET_RE.match(line)
        if bullet:
            level = min(len(bullet.group(1)) // 2, 3)
            blocks.append({"type": "bullet", "level": level, "text": bullet.group(2).strip()})
            index += 1
            continue

        ordered = _ORDERED_RE.match(line)
        if ordered:
            level = min(len(ordered.group(1)) // 2, 3)
            number = re.match(r"^\s*(\d+)", line).group(1)  # type: ignore[union-attr]
            blocks.append(
                {"type": "ordered", "level": level, "number": number, "text": ordered.group(2).strip()}
            )
            index += 1
            continue

        if _QUOTE_RE.match(line):
            collected: list[str] = []
            while index < len(lines) and _QUOTE_RE.match(lines[index]):
                collected.append(_QUOTE_RE.match(lines[index]).group(1))  # type: ignore[union-attr]
                index += 1
            blocks.append({"type": "quote", "text": " ".join(collected).strip()})
            continue

        if not stripped:
            index += 1
            continue

        paragraph: list[str] = []
        while index < len(lines):
            candidate = lines[index]
            if not candidate.strip():
                break
            if (
                _HEADING_RE.match(candidate.strip())
                or _BULLET_RE.match(candidate)
                or _ORDERED_RE.match(candidate)
                or _QUOTE_RE.match(candidate)
                or _TABLE_ROW_RE.match(candidate)
                or candidate.strip().startswith("```")
                or _HR_RE.match(candidate)
            ):
                break
            paragraph.append(candidate.strip())
            index += 1
        blocks.append({"type": "paragraph", "text": " ".join(paragraph).strip()})
    return blocks


def _split_table_row(raw: str) -> list[str]:
    cells = raw.strip().strip("|").split("|")
    return [cell.strip() for cell in cells]


# ----------------------------------------------------------------------
# Layout
# ----------------------------------------------------------------------

class _Layout:
    def __init__(self) -> None:
        self.doc = fitz.open()
        self.page = self.doc.new_page(width=_PAGE_WIDTH, height=_PAGE_HEIGHT)
        self.y = _MARGIN_TOP
        self.bottom = _PAGE_HEIGHT - _MARGIN_BOTTOM - _FOOTER_HEIGHT

    def new_page(self) -> None:
        self.page = self.doc.new_page(width=_PAGE_WIDTH, height=_PAGE_HEIGHT)
        self.y = _MARGIN_TOP

    def ensure(self, needed: float) -> None:
        if self.y + needed > self.bottom:
            self.new_page()

    def wrap(self, text: str, font: str, size: float, width: float) -> list[str]:
        text = _safe(_strip_inline(text))
        if not text:
            return []
        words = text.split()
        lines: list[str] = []
        current = ""
        for word in words:
            trial = word if not current else f"{current} {word}"
            if fitz.get_text_length(trial, fontname=font, fontsize=size) <= width:
                current = trial
                continue
            if current:
                lines.append(current)
            while fitz.get_text_length(word, fontname=font, fontsize=size) > width and len(word) > 1:
                cut = len(word)
                while cut > 1 and fitz.get_text_length(word[:cut], fontname=font, fontsize=size) > width:
                    cut -= 1
                lines.append(word[:cut])
                word = word[cut:]
            current = word
        if current:
            lines.append(current)
        return lines

    def text(self, line: str, font: str, size: float, *, x: float = _MARGIN_X,
             color: tuple = _INK, gap: float = _LINE_GAP) -> None:
        self.ensure(size * gap)
        self.page.insert_text((x, self.y + size), line, fontname=font, fontsize=size, color=color)
        self.y += size * gap

    def lines(self, lines: list[str], font: str, size: float, *, x: float = _MARGIN_X,
              color: tuple = _INK, gap: float = _LINE_GAP) -> None:
        for line in lines:
            self.text(line, font, size, x=x, color=color, gap=gap)

    def space(self, amount: float) -> None:
        self.y += amount
        if self.y > self.bottom:
            self.new_page()

    def rule(self, *, color: tuple = _RULE, width: float = 0.7) -> None:
        self.ensure(8)
        self.page.draw_line(
            fitz.Point(_MARGIN_X, self.y + 2),
            fitz.Point(_PAGE_WIDTH - _MARGIN_X, self.y + 2),
            color=color,
            width=width,
        )
        self.y += 8


def _render_blocks(layout: _Layout, blocks: list[dict]) -> None:
    for block in blocks:
        kind = block["type"]

        if kind == "heading":
            font, size = _HEADINGS.get(block["level"], _HEADINGS[6])
            layout.space(6)
            layout.lines(layout.wrap(block["text"], font, size, _CONTENT_W), font, size)
            if block["level"] <= 2:
                layout.rule()
            else:
                layout.space(2)
        elif kind == "paragraph":
            layout.lines(layout.wrap(block["text"], "helv", 10.5, _CONTENT_W), "helv", 10.5)
            layout.space(6)
        elif kind == "bullet":
            indent = 14 + block["level"] * 14
            wrapped = layout.wrap(block["text"], "helv", 10.5, _CONTENT_W - indent)
            for position, line in enumerate(wrapped):
                marker = "•" if position == 0 else " "
                layout.text(f"{marker} {line}" if position == 0 else line,
                            "helv", 10.5, x=_MARGIN_X + indent - 12)
            layout.space(2)
        elif kind == "ordered":
            indent = 14 + block["level"] * 14
            wrapped = layout.wrap(block["text"], "helv", 10.5, _CONTENT_W - indent)
            for position, line in enumerate(wrapped):
                prefix = f"{block['number']}." if position == 0 else ""
                layout.text(f"{prefix} {line}".strip(), "helv", 10.5,
                            x=_MARGIN_X + indent - 14)
            layout.space(2)
        elif kind == "quote":
            wrapped = layout.wrap(block["text"], "heit", 10.5, _CONTENT_W - 18)
            for line in wrapped:
                layout.text(line, "heit", 10.5, x=_MARGIN_X + 14, color=_MUTED)
            layout.space(6)
        elif kind == "code":
            for raw in _safe(block["text"]).split("\n"):
                wrapped = layout.wrap(raw, "cour", 8.8, _CONTENT_W - 16) or [""]
                for line in wrapped:
                    layout.text(line, "cour", 8.8, x=_MARGIN_X + 8, gap=1.28)
            layout.space(6)
        elif kind == "table":
            _render_table(layout, block["rows"])
        elif kind == "hr":
            layout.space(4)
            layout.rule()
            layout.space(4)


def _render_table(layout: _Layout, rows: list[list[str]]) -> None:
    columns = max(len(row) for row in rows)
    if columns == 0:
        return
    weights = [
        max((len(row[i]) if i < len(row) else 0) for row in rows) or 1
        for i in range(columns)
    ]
    total = sum(weights)
    widths = [max(_CONTENT_W * weight / total, 44.0) for weight in weights]
    scale = _CONTENT_W / sum(widths)
    widths = [width * scale for width in widths]

    for row_index, row in enumerate(rows):
        cell_lines = [
            layout.wrap(row[i] if i < len(row) else "", "cour", 8.6, widths[i] - 8)
            for i in range(columns)
        ]
        row_height = max(len(lines) for lines in cell_lines) * 8.6 * 1.28 + 6
        layout.ensure(row_height)
        x = _MARGIN_X
        for i in range(columns):
            for line_index, line in enumerate(cell_lines[i]):
                layout.page.insert_text(
                    (x + 4, layout.y + 9 + line_index * 8.6 * 1.28),
                    line,
                    fontname="cour",
                    fontsize=8.6,
                    color=_INK if row_index else (0.05, 0.05, 0.05),
                )
            x += widths[i]
        layout.y += row_height
        if row_index == 0:
            layout.page.draw_line(
                fitz.Point(_MARGIN_X, layout.y - 3),
                fitz.Point(_PAGE_WIDTH - _MARGIN_X, layout.y - 3),
                color=_RULE,
                width=0.7,
            )
    layout.space(6)


def render_note_pdf(title: str, content: str) -> bytes:
    """Render note Markdown to PDF bytes (a valid, multi-page document)."""
    if fitz is None:
        raise PdfUnavailable(
            "PDF rendering needs PyMuPDF. Install it with `pip install pymupdf`."
        )

    layout = _Layout()
    blocks = _parse_blocks(content)
    if not blocks:
        blocks = [{"type": "paragraph", "text": _strip_inline(title) or "No content."}]
    _render_blocks(layout, blocks)

    # Footer with the title and "Page x of y" on every page.
    total = layout.doc.page_count
    for number in range(total):
        page = layout.doc[number]
        page.draw_line(
            fitz.Point(_MARGIN_X, _PAGE_HEIGHT - _MARGIN_BOTTOM - 10),
            fitz.Point(_PAGE_WIDTH - _MARGIN_X, _PAGE_HEIGHT - _MARGIN_BOTTOM - 10),
            color=_RULE,
            width=0.5,
        )
        page.insert_text(
            (_MARGIN_X, _PAGE_HEIGHT - _MARGIN_BOTTOM + 6),
            _safe(title)[:80],
            fontname="helv",
            fontsize=8,
            color=_MUTED,
        )
        label = f"Page {number + 1} of {total}"
        width = fitz.get_text_length(label, fontname="helv", fontsize=8)
        page.insert_text(
            (_PAGE_WIDTH - _MARGIN_X - width, _PAGE_HEIGHT - _MARGIN_BOTTOM + 6),
            label,
            fontname="helv",
            fontsize=8,
            color=_MUTED,
        )

    data = layout.doc.tobytes()  # type: ignore[union-attr]
    layout.doc.close()
    return data  # type: ignore[no-any-return]
