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
