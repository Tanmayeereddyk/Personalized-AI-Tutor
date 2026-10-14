/**
 * LaTeX math tokenisation shared by the Markdown renderer and the lighter
 * inline surfaces (quiz prompts, flashcard faces, …).
 *
 * This module only *finds* math — it never rewrites the text around it. A `$`
 * that does not open a well-formed expression (a currency amount, an escaped
 * `\$`, an unterminated span) is left exactly as it was, so ordinary prose,
 * prices and code are never corrupted. Rendering lives in
 * `@/components/math/Math`.
 *
 * Supported delimiters:
 *   inline:  $…$    and  \(…\)
 *   display: $$…$$  and  \[…\]
 */

/** A math expression located inside a larger string. */
export interface MathSpan {
  /** Index of the opening delimiter. */
  start: number;
  /** Index just past the closing delimiter. */
  end: number;
  /** The LaTeX between the delimiters, trimmed. */
  latex: string;
  /** `true` for `$$…$$` / `\[…\]`, `false` for `$…$` / `\(…\)`. */
  display: boolean;
}

/** A span of literal text between math expressions. */
export interface PlainTextPart {
  type: "text";
  value: string;
}

/** A math expression within an inline string. */
export interface MathTextPart {
  type: "math";
  latex: string;
  display: boolean;
}

export type RichTextPart = PlainTextPart | MathTextPart;

/** The opening delimiter found at the start of a line, if any. */
export interface DisplayMathOpen {
  /** The token that closes the block. */
  close: "$$" | "\\]";
  /** Whatever followed the opening delimiter on the same line. */
  rest: string;
}

/**
 * Inline math has to stay usable as a *span*: an expression that contains a
 * blank line (or, for the `$` form, any newline) is almost certainly not math
 * but a stray delimiter, so it is left as text instead of swallowing the rest
 * of the document.
 */
function isUsable(latex: string, display: boolean): boolean {
  const trimmed = latex.trim();
  if (!trimmed) return false;
  if (!display && trimmed.includes("\n")) return false;
  return true;
}

/**
 * Try to read a complete math span starting exactly at `index`.
 *
 * Returns `null` when `index` does not begin a well-formed expression, which
 * lets the caller treat the character as ordinary text.
 */
export function matchMathAt(text: string, index: number): MathSpan | null {
  // Display: $$…$$
  if (text.startsWith("$$", index)) {
    const close = text.indexOf("$$", index + 2);
    if (close === -1) return null;
    const latex = text.slice(index + 2, close);
    if (!isUsable(latex, true)) return null;
    return { start: index, end: close + 2, latex: latex.trim(), display: true };
  }

  // Display/inline: \[…\] and \(…\)
  if (text.startsWith("\\[", index) || text.startsWith("\\(", index)) {
    const display = text.startsWith("\\[", index);
    const closeToken = display ? "\\]" : "\\)";
    const close = text.indexOf(closeToken, index + 2);
    if (close === -1) return null;
    const latex = text.slice(index + 2, close);
    if (!isUsable(latex, display)) return null;
    return {
      start: index,
      end: close + closeToken.length,
      latex: latex.trim(),
      display,
    };
  }

  // Inline: $…$
  if (text[index] === "$") {
    const afterOpen = text[index + 1];
    if (afterOpen === undefined || afterOpen === "" || /\s/.test(afterOpen)) return null;

    let cursor = index + 1;
    while (cursor < text.length) {
      const char = text[cursor];
      if (char === "\n") return null;
      if (char === "\\") {
        cursor += 2;
        continue;
      }
      if (char === "$") {
        const before = text[cursor - 1];
        const after = text[cursor + 1];
        const closes =
          before !== undefined &&
          !/\s/.test(before) &&
          after !== "$" &&
          !(after !== undefined && /\d/.test(after));
        if (closes) {
          const latex = text.slice(index + 1, cursor);
          if (!isUsable(latex, false)) return null;
          return { start: index, end: cursor + 1, latex: latex.trim(), display: false };
        }
        // A `$` that cannot close (e.g. a currency amount) means this opening
        // `$` is not math at all — never pair it with a later dollar sign.
        return null;
      }
      cursor += 1;
    }
    return null;
  }

  return null;
}

/** Find every non-overlapping math span in `text`, left to right. */
export function findInlineMath(text: string): MathSpan[] {
  const spans: MathSpan[] = [];
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === "$" || char === "\\") {
      const span = matchMathAt(text, index);
      if (span) {
        spans.push(span);
        index = span.end;
        continue;
      }
    }
    index += 1;
  }
  return spans;
}

/**
 * Split a string into alternating plain-text and math parts. Text without any
 * math is returned as a single part, untouched.
 */
export function splitInlineMath(text: string): RichTextPart[] {
  const spans = findInlineMath(text);
  if (spans.length === 0) return text ? [{ type: "text", value: text }] : [];

  const parts: RichTextPart[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start > cursor) parts.push({ type: "text", value: text.slice(cursor, span.start) });
    parts.push({ type: "math", latex: span.latex, display: span.display });
    cursor = span.end;
  }
  if (cursor < text.length) parts.push({ type: "text", value: text.slice(cursor) });
  return parts;
}

/**
 * Detect a display-math block opener (`$$` or `\[`) at the start of a line.
 * `line` is expected to be already trimmed.
 */
export function matchDisplayMathOpen(line: string): DisplayMathOpen | null {
  if (line.startsWith("$$")) return { close: "$$", rest: line.slice(2) };
  if (line.startsWith("\\[")) return { close: "\\]", rest: line.slice(2) };
  return null;
}
