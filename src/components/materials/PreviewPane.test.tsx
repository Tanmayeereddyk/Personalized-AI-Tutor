import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Material, MaterialPreview } from "@/lib/types";
import { PreviewPane } from "./PreviewPane";

/**
 * The material preview is a viewer convenience layered on the
 * backend conversion. These tests pin the states the user sees:
 * a spinner while the preview is being prepared, the converted
 * PDF in the existing iframe viewer, the ordered slide-text
 * fallback for decks, the extracted-text preview for documents
 * and plain text, and a clear explanation (with the download
 * still available in the header) when nothing can render.
 */

const h = vi.hoisted(() => ({
  preview: { data: null as MaterialPreview | null },
  start: { mutate: vi.fn(), isPending: false },
}));

vi.mock("@/lib/queries", () => ({
  useMaterialPreview: (_id: string, _enabled = true) => h.preview,
  useStartMaterialPreview: (_id: string) => h.start,
}));

const pptx: Material = {
  id: "m1",
  courseId: "c1",
  name: "deck.pptx",
  type: "ppt",
  kind: "Slides",
  meta: "1.2 MB",
  added: "Added today",
  status: "ready",
};

const docx: Material = {
  id: "m2",
  courseId: "c1",
  name: "notes.docx",
  type: "doc",
  kind: "Upload",
  meta: "12 kB",
  added: "Added today",
  status: "ready",
};

const txt: Material = {
  id: "m3",
  courseId: "c1",
  name: "notes.txt",
  type: "doc",
  kind: "Upload",
  meta: "1 kB",
  added: "Added today",
  status: "ready",
};

function setPreview(preview: MaterialPreview | null) {
  h.preview = { data: preview };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.start = { mutate: vi.fn(), isPending: false };
  setPreview(null);
});

describe("PreviewPane", () => {
  it("starts preparing the preview when the material opens", () => {
    render(<PreviewPane material={pptx} />);
    expect(h.start.mutate).toHaveBeenCalled();
  });

  it("shows a loading state while the preview is being prepared", () => {
    setPreview({
      status: "processing",
      mode: "none",
      url: null,
      slides: [],
      text: null,
      message: "Preparing the preview…",
    });
    render(<PreviewPane material={pptx} />);
    expect(screen.getByText("Preparing the preview…")).toBeTruthy();
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("renders the converted PDF in the existing PDF viewer", () => {
    setPreview({
      status: "ready",
      mode: "pdf",
      url: "https://files.example.com/preview.pdf?token=test",
      slides: [],
      text: "Extracted page text",
      message: null,
    });
    render(<PreviewPane material={pptx} />);
    expect(screen.getByRole("button", { name: "Extracted text" })).toBeTruthy();
    const iframe = document.querySelector("iframe");
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute("src")).toContain("https://files.example.com/preview.pdf?token=test#toolbar=1");
    expect(screen.getByRole("button", { name: "View PDF fullscreen" })).toBeTruthy();
  });

  it("keeps extracted text available beside the converted PDF", async () => {
    setPreview({
      status: "ready",
      mode: "pdf",
      url: "https://files.example.com/preview.pdf?token=test",
      slides: [],
      text: "Extracted page text",
      message: null,
    });
    render(<PreviewPane material={docx} />);
    screen.getByRole("button", { name: "Extracted text" }).click();
    expect(await screen.findByText("Extracted page text")).toBeTruthy();
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("renders the slide-text fallback in slide order", () => {
    setPreview({
      status: "unsupported",
      mode: "slides",
      url: null,
      message: "Showing extracted slide text instead.",
      slides: [
        { number: 1, text: "First slide", imageUrl: null },
        { number: 2, text: "Second slide", imageUrl: null },
        { number: 3, text: "Third slide", imageUrl: null },
      ],
      text: null,
    });
    render(<PreviewPane material={pptx} />);
    expect(screen.getByText("First slide")).toBeTruthy();
    expect(screen.getByText("Second slide")).toBeTruthy();
    expect(screen.getByText("Third slide")).toBeTruthy();
    // Slide numbers are labelled and in ascending order.
    const labels = screen
      .getAllByText(/^Slide \d+$/)
      .map((node) => node.textContent);
    expect(labels).toEqual(["Slide 1", "Slide 2", "Slide 3"]);
  });

  it("renders document text for a Word file", () => {
    setPreview({
      status: "ready",
      mode: "text",
      url: null,
      slides: [],
      text: "First paragraph.\n\nSecond paragraph.",
      message: null,
    });
    render(<PreviewPane material={docx} />);
    const pre = document.querySelector("pre");
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toContain("First paragraph.");
    expect(pre?.textContent).toContain("Second paragraph.");
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("renders plain text directly", () => {
    setPreview({
      status: "ready",
      mode: "text",
      url: null,
      slides: [],
      text: "Plain text line one.\nPlain text line two.",
      message: null,
    });
    render(<PreviewPane material={txt} />);
    const pre = document.querySelector("pre");
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toContain("Plain text line one.");
    expect(pre?.textContent).toContain("Plain text line two.");
  });

  it("explains a failed conversion but still offers the slide text", () => {
    setPreview({
      status: "failed",
      mode: "slides",
      url: null,
      message:
        "The file could not be converted for an inline preview. You can still download the original file.",
      slides: [{ number: 1, text: "Only slide", imageUrl: null }],
      text: null,
    });
    render(<PreviewPane material={pptx} />);
    expect(
      screen.getByText(/could not be converted for an inline preview/),
    ).toBeTruthy();
    expect(screen.getByText("Only slide")).toBeTruthy();
  });

  it("explains clearly when there is nothing to render", () => {
    setPreview({
      status: "unsupported",
      mode: "none",
      url: null,
      slides: [],
      text: null,
      message: "Inline rendering needs LibreOffice on the server.",
    });
    render(<PreviewPane material={pptx} />);
    expect(screen.getByText("No inline preview available")).toBeTruthy();
    expect(
      screen.getByText("Inline rendering needs LibreOffice on the server."),
    ).toBeTruthy();
    // No PDF iframe, slide list or text block is rendered.
    expect(document.querySelector("iframe")).toBeNull();
    expect(screen.queryByText(/^Slide \d+$/)).toBeNull();
  });
});
