import { Fragment, type ReactNode } from "react";

import { MathExpression } from "@/components/math/Math";
import { matchDisplayMathOpen, matchMathAt } from "@/lib/math";
import { cn } from "@/lib/utils";

/**
 * Render generated notes (Markdown) as a typeset study document.
 *
 * Parsing happens in the browser and produces React elements directly — the
 * only HTML ever injected is the markup KaTeX generates for an equation (with
 * `trust: false`), so any HTML the model might emit is treated as plain text and
 * can never be executed. Only links to http(s) URLs become anchors.
 *
 * Math is supported inline (`$…$`, `\(…\)`) and as standalone blocks
 * (`$$…$$`, `\[…\]`); a `$` that is really currency is left as text.
 */

// ----------------------------------------------------------------------
// Inline formatting
// ----------------------------------------------------------------------

const INLINE_PATTERN =
  /`([^`]+)`|\*\*([^*]+)\*\*|__([^_]+)__|\[([^\]]+)\]\(([^)]+)\)|\[#(\d+)\]|(?<![A-Za-z0-9])\*([^*]+)\*(?![A-Za-z0-9])|(?<![A-Za-z0-9])_([^_]+)_(?![A-Za-z0-9])/g;

/**
 * Code spans and math are lifted out of the string before the inline markdown
 * pattern runs, then swapped back when the text becomes React nodes. This keeps
 * `*`, `_` and `$` inside code and math from being re-read as emphasis, and
 * stops emphasis from splitting a math expression in half. The placeholders use
 * private-use characters that cannot occur in the generated content.
 */
type InlineAtom =
  | { type: "code"; value: string }
  | { type: "math"; value: string; display: boolean };

const ATOM_OPEN = "\uE000";
const ATOM_CLOSE = "\uE001";
const ATOM_RE = new RegExp(`${ATOM_OPEN}(\\d+)${ATOM_CLOSE}`, "g");

function atomPlaceholder(index: number): string {
  return `${ATOM_OPEN}${index}${ATOM_CLOSE}`;
}

function protectInlineAtoms(text: string): { masked: string; atoms: InlineAtom[] } {
  const atoms: InlineAtom[] = [];

  // Pass 1: pull out code spans. Doing this first means a `$` inside code (or a
  // stray currency `$` just before it) can never be paired with a later dollar.
  let codeMasked = "";
  let index = 0;
  while (index < text.length) {
    const char = text[index]!;
    if (char === "`") {
      let run = 1;
      while (text[index + run] === "`") run += 1;
      const fence = "`".repeat(run);
      const close = text.indexOf(fence, index + run);
      if (close !== -1) {
        codeMasked += atomPlaceholder(atoms.length);
        atoms.push({ type: "code", value: text.slice(index + run, close) });
        index = close + run;
        continue;
      }
    }
    codeMasked += char;
    index += 1;
  }

  // Pass 2: pull out math from whatever text is left.
  let masked = "";
  index = 0;
  while (index < codeMasked.length) {
    const char = codeMasked[index]!;
    if (char === "$" || char === "\\") {
      const span = matchMathAt(codeMasked, index);
      if (span) {
        masked += atomPlaceholder(atoms.length);
        atoms.push({ type: "math", value: span.latex, display: span.display });
        index = span.end;
        continue;
      }
    }
    masked += char;
    index += 1;
  }

  return { masked, atoms };
}

function restoreAtoms(text: string, atoms: InlineAtom[], keyPrefix: string): ReactNode[] {
  if (!text.includes(ATOM_OPEN)) return text ? [text] : [];
  const nodes: ReactNode[] = [];
  let last = 0;
  let count = 0;
  ATOM_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATOM_RE.exec(text)) !== null) {
    if (match.index > last) nodes.push(text.slice(last, match.index));
    const atom = atoms[Number(match[1])];
    const key = `${keyPrefix}-a${count++}`;
    if (atom?.type === "code") {
      nodes.push(
        <code key={key} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
          {atom.value}
        </code>,
      );
    } else if (atom?.type === "math") {
      nodes.push(<MathExpression key={key} latex={atom.value} display={atom.display} />);
    }
    last = match.index + match[0].length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const { masked, atoms } = protectInlineAtoms(text);
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  INLINE_PATTERN.lastIndex = 0;
  while ((match = INLINE_PATTERN.exec(masked)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(
        ...restoreAtoms(masked.slice(lastIndex, match.index), atoms, `${keyPrefix}-t${index}`),
      );
    }
    const key = `${keyPrefix}-i${index++}`;
    const [, code, bold1, bold2, linkText, linkUrl, citation, italic1, italic2] = match;

    if (code !== undefined) {
      nodes.push(
        <code key={key} className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em]">
          {code}
        </code>,
      );
    } else if (bold1 !== undefined || bold2 !== undefined) {
      nodes.push(<strong key={key}>{restoreAtoms(bold1 ?? bold2 ?? "", atoms, key)}</strong>);
    } else if (italic1 !== undefined || italic2 !== undefined) {
      nodes.push(<em key={key}>{restoreAtoms(italic1 ?? italic2 ?? "", atoms, key)}</em>);
    } else if (linkText !== undefined && linkUrl !== undefined) {
      if (/^https?:\/\//i.test(linkUrl)) {
        nodes.push(
          <a
            key={key}
            href={linkUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="text-primary underline underline-offset-2"
          >
            {restoreAtoms(linkText, atoms, key)}
          </a>,
        );
      } else {
        nodes.push(<Fragment key={key}>{restoreAtoms(linkText, atoms, key)}</Fragment>);
      }
    } else if (citation !== undefined) {
      nodes.push(
        <sup
          key={key}
          className="ml-0.5 rounded bg-secondary px-1 text-[10px] font-medium text-primary"
        >
          {citation}
        </sup>,
      );
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < masked.length) {
    nodes.push(...restoreAtoms(masked.slice(lastIndex), atoms, `${keyPrefix}-end`));
  }
  return nodes;
}

// ----------------------------------------------------------------------
// Block parsing
// ----------------------------------------------------------------------

type Block =
  | { type: "heading"; level: number; text: string }
  | { type: "paragraph"; text: string }
  | { type: "bullet"; level: number; text: string }
  | { type: "ordered"; level: number; number: string; text: string }
  | { type: "quote"; text: string }
  | { type: "code"; text: string }
  | { type: "math"; text: string }
  | { type: "table"; rows: string[][] }
  | { type: "hr" };

const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const BULLET_RE = /^(\s*)[-*+]\s+(.*)$/;
const ORDERED_RE = /^(\s*)(\d+)[.)]\s+(.*)$/;
const QUOTE_RE = /^>\s?(.*)$/;
const TABLE_ROW_RE = /^\s*\|.*\|\s*$/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;
const HR_RE = /^\s*([-*_])(?:\s*\1){2,}\s*$/;

function splitRow(raw: string): string[] {
  return raw
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

export function parseBlocks(markdown: string): Block[] {
  const lines = (markdown || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const stripped = line.trim();

    if (stripped.startsWith("```")) {
      index += 1;
      const code: string[] = [];
      while (index < lines.length && !(lines[index] ?? "").trim().startsWith("```")) {
        code.push(lines[index] ?? "");
        index += 1;
      }
      index += 1;
      blocks.push({ type: "code", text: code.join("\n") });
      continue;
    }

    // Standalone display math block: $$…$$ or \[…\]. A one-line block closes on
    // the same line; otherwise collect until a line containing the closer.
    const displayMath = matchDisplayMathOpen(stripped);
    if (displayMath) {
      const sameLine = displayMath.rest.indexOf(displayMath.close);
      if (sameLine !== -1) {
        const latex = displayMath.rest.slice(0, sameLine).trim();
        const tail = displayMath.rest.slice(sameLine + displayMath.close.length).trim();
        if (latex) blocks.push({ type: "math", text: latex });
        if (tail) blocks.push({ type: "paragraph", text: tail });
        index += 1;
        continue;
      }
      let closeIndex = -1;
      for (let scan = index + 1; scan < lines.length; scan += 1) {
        if ((lines[scan] ?? "").includes(displayMath.close)) {
          closeIndex = scan;
          break;
        }
      }
      if (closeIndex !== -1) {
        const body: string[] = [displayMath.rest];
        for (let scan = index + 1; scan < closeIndex; scan += 1) body.push(lines[scan] ?? "");
        const closingLine = lines[closeIndex] ?? "";
        const at = closingLine.indexOf(displayMath.close);
        body.push(closingLine.slice(0, at));
        const tail = closingLine.slice(at + displayMath.close.length).trim();
        const latex = body.join("\n").trim();
        if (latex) blocks.push({ type: "math", text: latex });
        if (tail) blocks.push({ type: "paragraph", text: tail });
        index = closeIndex + 1;
        continue;
      }
      // Unterminated opener — fall through and treat it as ordinary text.
    }

    const heading = HEADING_RE.exec(stripped);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1]!.length, text: heading[2]!.trim() });
      index += 1;
      continue;
    }

    if (HR_RE.test(line)) {
      blocks.push({ type: "hr" });
      index += 1;
      continue;
    }

    if (TABLE_ROW_RE.test(line)) {
      const rows: string[][] = [];
      while (index < lines.length && TABLE_ROW_RE.test(lines[index] ?? "")) {
        if (!TABLE_SEP_RE.test(lines[index] ?? "")) rows.push(splitRow(lines[index] ?? ""));
        index += 1;
      }
      if (rows.length) blocks.push({ type: "table", rows });
      continue;
    }

    const bullet = BULLET_RE.exec(line);
    if (bullet) {
      blocks.push({
        type: "bullet",
        level: Math.min(Math.floor((bullet[1]?.length ?? 0) / 2), 3),
        text: bullet[2]!.trim(),
      });
      index += 1;
      continue;
    }

    const ordered = ORDERED_RE.exec(line);
    if (ordered) {
      blocks.push({
        type: "ordered",
        level: Math.min(Math.floor((ordered[1]?.length ?? 0) / 2), 3),
        number: ordered[2]!,
        text: ordered[3]!.trim(),
      });
      index += 1;
      continue;
    }

    const quote = QUOTE_RE.exec(line);
    if (quote) {
      const collected: string[] = [];
      while (index < lines.length) {
        const q = QUOTE_RE.exec(lines[index] ?? "");
        if (!q) break;
        collected.push(q[1] ?? "");
        index += 1;
      }
      blocks.push({ type: "quote", text: collected.join(" ").trim() });
      continue;
    }

    if (!stripped) {
      index += 1;
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const candidate = lines[index] ?? "";
      if (
        !candidate.trim() ||
        HEADING_RE.test(candidate.trim()) ||
        BULLET_RE.test(candidate) ||
        ORDERED_RE.test(candidate) ||
        QUOTE_RE.test(candidate) ||
        TABLE_ROW_RE.test(candidate) ||
        HR_RE.test(candidate) ||
        matchDisplayMathOpen(candidate.trim()) !== null ||
        candidate.trim().startsWith("```")
      ) {
        break;
      }
      paragraph.push(candidate.trim());
      index += 1;
    }
    blocks.push({ type: "paragraph", text: paragraph.join(" ") });
  }

  return blocks;
}

// ----------------------------------------------------------------------
// Rendering
// ----------------------------------------------------------------------

function Heading({ level, text, keyPrefix }: { level: number; text: string; keyPrefix: string }) {
  const children = renderInline(text, keyPrefix);
  if (level === 1) {
    return (
      <h1 className="mb-4 mt-1 border-b pb-3 text-center text-2xl font-semibold tracking-tight">
        {children}
      </h1>
    );
  }
  if (level === 2) {
    return (
      <h2 className="mb-2 mt-6 border-b pb-1 text-lg font-semibold first:mt-0">{children}</h2>
    );
  }
  if (level === 3) {
    return <h3 className="mb-1.5 mt-4 text-base font-semibold">{children}</h3>;
  }
  return <h4 className="mb-1 mt-3 text-sm font-semibold">{children}</h4>;
}

function renderBlock(block: Block, key: string): ReactNode {
  switch (block.type) {
    case "heading":
      return <Heading key={key} level={block.level} text={block.text} keyPrefix={key} />;
    case "paragraph":
      return (
        <p key={key} className="my-2 leading-relaxed">
          {renderInline(block.text, key)}
        </p>
      );
    case "bullet":
      return (
        <ul
          key={key}
          className="my-1 list-disc space-y-1 leading-relaxed"
          style={{ paddingLeft: `${1.1 + block.level * 1.1}rem` }}
        >
          <li>{renderInline(block.text, key)}</li>
        </ul>
      );
    case "ordered":
      return (
        <ol
          key={key}
          start={Number(block.number)}
          className="my-1 list-decimal space-y-1 leading-relaxed"
          style={{ paddingLeft: `${1.3 + block.level * 1.1}rem` }}
        >
          <li>{renderInline(block.text, key)}</li>
        </ol>
      );
    case "quote":
      return (
        <blockquote
          key={key}
          className="my-2 border-l-2 border-primary/40 pl-3 italic text-muted-foreground"
        >
          {renderInline(block.text, key)}
        </blockquote>
      );
    case "code":
      return (
        <pre
          key={key}
          className="my-3 overflow-x-auto rounded-xl bg-muted px-3.5 py-3 font-mono text-xs leading-relaxed"
        >
          <code>{block.text}</code>
        </pre>
      );
    case "math":
      return <MathExpression key={key} latex={block.text} display className="my-1" />;
    case "table":
      return (
        <div key={key} className="my-3 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={`${key}-r${rowIndex}`} className={rowIndex === 0 ? "bg-secondary/60" : ""}>
                  {row.map((cell, cellIndex) => {
                    const Cell = rowIndex === 0 ? "th" : "td";
                    return (
                      <Cell
                        key={`${key}-r${rowIndex}c${cellIndex}`}
                        className={cn(
                          "border px-2.5 py-1.5 text-left align-top",
                          rowIndex === 0 && "font-semibold",
                        )}
                      >
                        {renderInline(cell, `${key}-r${rowIndex}c${cellIndex}`)}
                      </Cell>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "hr":
      return <hr key={key} className="my-4 border-t" />;
    default:
      return null;
  }
}

export function MarkdownDocument({
  markdown,
  className,
}: {
  markdown: string;
  className?: string;
}) {
  const blocks = parseBlocks(markdown);
  return (
    <div className={cn("text-sm leading-relaxed text-foreground", className)}>
      {blocks.map((block, index) => renderBlock(block, `b${index}`))}
    </div>
  );
}
