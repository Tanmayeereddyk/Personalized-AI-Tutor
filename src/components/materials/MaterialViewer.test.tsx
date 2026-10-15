import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Material } from "@/lib/types";
import { MaterialViewer } from "./MaterialViewer";

const h = vi.hoisted(() => ({ url: vi.fn(async () => "https://files.example.com/private.pdf?token=short-lived") }));

vi.mock("@/lib/api", () => ({ api: { materials: { url: h.url } } }));
vi.mock("@/lib/queries", () => ({
  useExtractionStatus: () => ({ data: null }),
  useTranscript: () => ({ data: [], isLoading: false, isError: false }),
  useMaterialPreview: () => ({ data: null }),
  useStartMaterialPreview: () => ({ mutate: vi.fn(), isPending: false }),
}));

const material = (overrides: Partial<Material> = {}): Material => ({
  id: "m1",
  courseId: "c1",
  name: "lecture.pdf",
  type: "pdf",
  kind: "Document",
  meta: "1 MB",
  added: "Added today",
  status: "ready",
  mimeType: "application/pdf",
  ...overrides,
});

beforeEach(() => vi.clearAllMocks());

describe("MaterialViewer", () => {
  it("renders the original owner-authorized PDF in the browser viewer", async () => {
    render(<MaterialViewer material={material()} />);
    await waitFor(() => expect(document.querySelector("iframe")).not.toBeNull());
    expect(document.querySelector("iframe")?.getAttribute("src")).toContain("private.pdf");
    expect(screen.getByRole("spinbutton", { name: "PDF page number" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "View PDF fullscreen" })).toBeTruthy();
    expect(h.url).toHaveBeenCalledWith("m1");
  });

  it("previews image MIME types directly rather than passing them to office conversion", async () => {
    render(
      <MaterialViewer
        material={material({ name: "diagram.png", type: "doc", mimeType: "image/png" })}
      />,
    );
    await waitFor(() => expect(screen.getByAltText("diagram.png")).toBeTruthy());
    expect(document.querySelector("iframe")).toBeNull();
    fireEvent.error(screen.getByAltText("diagram.png"));
    expect(screen.getByRole("alert").textContent).toContain("could not be displayed");
  });

  it("uses the native audio player for supported audio files", async () => {
    render(
      <MaterialViewer
        material={material({ name: "lecture.mp3", type: "doc", mimeType: "audio/mpeg" })}
      />,
    );
    await waitFor(() => expect(document.querySelector("audio[controls]")).not.toBeNull());
    expect(document.querySelector("iframe")).toBeNull();
  });
});
