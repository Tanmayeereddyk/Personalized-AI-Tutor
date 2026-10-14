import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { MarkdownDocument, parseBlocks } from "./MarkdownDocument";

describe("parseBlocks", () => {
  it("parses headings, lists, tables, quotes and code fences", () => {
    const blocks = parseBlocks(
      [
        "# Title",
        "",
        "## Concepts",
        "- first",
        "- second",
        "",
        "1. step one",
        "2. step two",
        "",
        "| Name | Value |",
        "| --- | --- |",
        "| ATP | energy |",
        "",
        "> A quote",
        "",
        "```",
        "x = 1",
        "```",
      ].join("\n"),
    );

    expect(blocks[0]).toEqual({ type: "heading", level: 1, text: "Title" });
    expect(blocks.filter((b) => b.type === "bullet")).toHaveLength(2);
    expect(blocks.filter((b) => b.type === "ordered")).toHaveLength(2);
    expect(blocks.find((b) => b.type === "table")).toMatchObject({
      rows: [
        ["Name", "Value"],
        ["ATP", "energy"],
      ],
    });
    expect(blocks).toContainEqual({ type: "quote", text: "A quote" });
    expect(blocks).toContainEqual({ type: "code", text: "x = 1" });
  });
});

describe("MarkdownDocument", () => {
  it("renders notes structure and citation markers", () => {
    render(
      <MarkdownDocument
        markdown={"# Photosynthesis\n\n## Key points\n\n- Plants use chlorophyll [#1]\n"}
      />,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Photosynthesis" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Key points" })).toBeTruthy();
    const item = screen.getByRole("listitem");
    expect(item.textContent).toContain("chlorophyll");
    expect(item.textContent).toContain("1"); // the [#1] citation chip
  });

  it("never injects HTML from note content", () => {
    render(<MarkdownDocument markdown={"Hello <script>alert(1)</script> world"} />);

    expect(document.querySelector("script")).toBeNull();
    expect(screen.getByText(/<script>/)).toBeTruthy();
  });
});

describe("MarkdownDocument math", () => {
  it("typesets inline math", () => {
    const { container } = render(
      <MarkdownDocument markdown={"The entry $A_{ij}$ lies in $\\mathbb{R}$."} />,
    );
    expect(container.querySelectorAll(".katex")).toHaveLength(2);
    expect(container.textContent).not.toContain("$A_{ij}$");
  });

  it("parses and renders a display equation block", () => {
    const source = ["Before", "", "$$", "A = 1", "$$", "", "After"].join("\n");
    expect(parseBlocks(source)).toContainEqual({ type: "math", text: "A = 1" });

    const { container } = render(<MarkdownDocument markdown={source} />);
    expect(container.querySelector(".katex-display")).toBeTruthy();
    expect(container.textContent).toContain("Before");
    expect(container.textContent).toContain("After");
  });

  it("renders a matrix as a display equation", () => {
    const { container } = render(
      <MarkdownDocument markdown={"$$\\begin{bmatrix} 1 & 2 \\\\ 3 & 4 \\end{bmatrix}$$"} />,
    );
    expect(container.querySelector(".katex-display")).toBeTruthy();
  });

  it("keeps currency and inline code intact", () => {
    const { container } = render(
      <MarkdownDocument markdown={"It costs $5 and $10. Use `$x$` verbatim."} />,
    );
    expect(container.querySelector(".katex")).toBeNull();
    expect(container.textContent).toContain("$5 and $10");
    expect(container.textContent).toContain("$x$");
  });

  it("renders math inside bullet lists without losing the list", () => {
    const { container } = render(
      <MarkdownDocument markdown={"- The vector $\\mathbf{v}$\n- The scalar $x_1$"} />,
    );
    expect(container.querySelectorAll("li")).toHaveLength(2);
    expect(container.querySelectorAll(".katex")).toHaveLength(2);
  });

  it("does not break on malformed LaTeX", () => {
    const { container } = render(<MarkdownDocument markdown={"Broken $\\frac{1}{$ here"} />);
    expect(container.textContent).toContain("Broken");
    expect(container.textContent).toContain("here");
  });
});
