import { describe, expect, it } from "vitest";

import { matchDisplayMathOpen, matchMathAt, splitInlineMath } from "./math";

describe("matchMathAt", () => {
  it("reads inline $…$ math", () => {
    const span = matchMathAt("value $A_{ij}$ here", 6);
    expect(span).toMatchObject({ latex: "A_{ij}", display: false, start: 6, end: 14 });
  });

  it("reads \\(…\\) inline math", () => {
    const span = matchMathAt("so \\(x_1\\) then", 3);
    expect(span).toMatchObject({ latex: "x_1", display: false });
  });

  it("reads $$…$$ and \\[…\\] display math", () => {
    expect(matchMathAt("$$E=mc^2$$", 0)).toMatchObject({ latex: "E=mc^2", display: true });
    expect(matchMathAt("\\[\\int_0^1 x\\,dx\\]", 0)).toMatchObject({ display: true });
  });

  it("rejects currency amounts", () => {
    expect(matchMathAt("costs $5 and $10", 6)).toBeNull();
    expect(matchMathAt("$5 to $7", 0)).toBeNull();
  });

  it("rejects unterminated and empty spans", () => {
    expect(matchMathAt("open $x", 5)).toBeNull();
    expect(matchMathAt("$ $", 0)).toBeNull();
  });
});

describe("splitInlineMath", () => {
  it("splits text around math and keeps prose intact", () => {
    const parts = splitInlineMath("Let $x_1$ and $\\mathbb{R}$ be given.");
    expect(parts).toEqual([
      { type: "text", value: "Let " },
      { type: "math", latex: "x_1", display: false },
      { type: "text", value: " and " },
      { type: "math", latex: "\\mathbb{R}", display: false },
      { type: "text", value: " be given." },
    ]);
  });

  it("handles \\dots, \\times and \\vdots", () => {
    const parts = splitInlineMath("$a \\times b$, $x_1, \\dots, x_n$ and $\\vdots$");
    expect(parts.filter((p) => p.type === "math")).toHaveLength(3);
  });

  it("returns non-math text untouched", () => {
    const text = "Plain text with $5 and $10 and no math.";
    expect(splitInlineMath(text)).toEqual([{ type: "text", value: text }]);
  });

  it("returns an empty array for an empty string", () => {
    expect(splitInlineMath("")).toEqual([]);
  });
});

describe("matchDisplayMathOpen", () => {
  it("detects $$ and \\[ openers", () => {
    expect(matchDisplayMathOpen("$$x=1")).toEqual({ close: "$$", rest: "x=1" });
    expect(matchDisplayMathOpen("\\[")).toEqual({ close: "\\]", rest: "" });
  });

  it("ignores ordinary lines", () => {
    expect(matchDisplayMathOpen("plain text")).toBeNull();
    expect(matchDisplayMathOpen("$5")).toBeNull();
  });
});
