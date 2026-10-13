import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Material } from "@/lib/types";
import { StudySurface, type StudySurfaceProps } from "./StudySurface";

/**
 * The study surface is the StudyFetch-style workspace: the compact view toolbar
 * (Notes / Transcript / View Material / Split Screen) plus the tutor rail.
 *
 * These tests pin the behaviours the workspace was built for: irrelevant
 * options disable themselves, the split view renders the material beside the
 * notes with draggable dividers, and switching modes never clears the tutor
 * conversation.
 */

const h = vi.hoisted(() => ({
  transcript: [] as Array<{ id: string; start: number; end: number; text: string }>,
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { id: "u1", name: "Ada", role: "student", email: "ada@example.com" },
    ready: true,
  }),
}));

vi.mock("@/lib/queries", () => ({
  useNotes: () => ({ data: [], isLoading: false, isError: false, error: null, refetch: vi.fn() }),
  useMaterials: () => ({
    data: [],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useExtractionStatus: () => ({ data: { status: "ready", stage: null, warnings: [] } }),
  useTranscript: () => ({ data: h.transcript, isLoading: false, isError: false }),
}));

vi.mock("@/lib/api", () => ({
  api: {
    materials: { url: vi.fn(async () => "blob:file") },
    notes: { pdfUrl: vi.fn(async () => "blob:pdf"), downloadPdf: vi.fn(async () => {}) },
    tutor: {
      ask: vi.fn(async () => ({
        answer: "Grounded answer from your materials.",
        citations: [],
        grounded: true,
        usedMaterials: [],
      })),
    },
  },
}));

const pdfMaterial: Material = {
  id: "m1",
  courseId: "c1",
  name: "lecture.pdf",
  type: "pdf",
  kind: "Document",
  meta: "1.0 MB",
  added: "today",
  status: "ready",
  mimeType: "application/pdf",
};

const videoMaterial: Material = {
  id: "m2",
  courseId: "c1",
  name: "lecture.mp4",
  type: "video",
  kind: "Video",
  meta: "20 MB",
  added: "today",
  status: "ready",
  mimeType: "video/mp4",
};

function renderSurface(overrides: Partial<StudySurfaceProps> = {}) {
  return render(
    <StudySurface
      courseId="c1"
      courseCode="DAA"
      material={pdfMaterial}
      view="notes"
      onViewChange={() => {}}
      selectedNoteId={null}
      onSelectNote={() => {}}
      onBack={() => {}}
      {...overrides}
    />,
  );
}

function viewGroup() {
  return screen.getByRole("group", { name: "Study view" });
}

function sendMessage(text: string) {
  const textarea = screen.getByLabelText("Message the tutor");
  fireEvent.change(textarea, { target: { value: text } });
  const form = textarea.closest("form");
  expect(form).not.toBeNull();
  fireEvent.submit(form as HTMLFormElement);
}

beforeEach(() => {
  window.localStorage.clear();
  h.transcript = [];
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: query.includes("min-width"),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
});

describe("StudySurface", () => {
  it("shows the four view options and disables Transcript for a PDF", () => {
    renderSurface({ material: pdfMaterial, view: "notes" });

    const group = viewGroup();
    expect(within(group).getByRole("button", { name: "Notes" })).toBeEnabled();
    expect(within(group).getByRole("button", { name: "Transcript" })).toBeDisabled();
    expect(within(group).getByRole("button", { name: "View PDF" })).toBeEnabled();
    expect(within(group).getByRole("button", { name: "Split Screen" })).toBeEnabled();
  });

  it("enables Transcript for a video that has a transcript", () => {
    h.transcript = [{ id: "s1", start: 0, end: 5, text: "Introduction" }];
    renderSurface({ material: videoMaterial, view: "notes" });

    expect(within(viewGroup()).getByRole("button", { name: "Transcript" })).toBeEnabled();
  });

  it("shows the material beside the notes in split screen, with draggable dividers", async () => {
    renderSurface({ material: pdfMaterial, view: "split" });

    expect(await screen.findByTitle("lecture.pdf")).toBeInTheDocument();
    expect(screen.getByText("Notes & materials")).toBeInTheDocument();
    expect(screen.getByText("DAA Tutor")).toBeInTheDocument();
    // One divider between material and notes, one between content and tutor.
    expect(screen.getByLabelText("Resize study panels")).toBeInTheDocument();
    expect(screen.getByLabelText("Resize content and tutor panels")).toBeInTheDocument();
  });

  it("reports the chosen view to the caller", () => {
    const onViewChange = vi.fn();
    renderSurface({ material: pdfMaterial, view: "notes", onViewChange });

    fireEvent.click(within(viewGroup()).getByRole("button", { name: "Split Screen" }));
    expect(onViewChange).toHaveBeenCalledWith("split");
  });

  it("keeps the tutor conversation when the panel is hidden and reopened", async () => {
    renderSurface({ material: pdfMaterial, view: "notes" });

    sendMessage("Explain dynamic programming");
    expect(await screen.findByText(/Grounded answer from your materials/)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Hide tutor panel"));
    expect(screen.queryByLabelText("Message the tutor")).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Show tutor panel"));
    expect(screen.getByText("Explain dynamic programming")).toBeInTheDocument();
  });
});
