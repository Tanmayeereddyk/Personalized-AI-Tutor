import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Notes } from "./courses.$courseId.notes";

vi.mock("@tanstack/react-router", () => {
  const useParams = () => ({ courseId: "c1" });
  const useNavigate = () => vi.fn();
  return {
    createFileRoute: () => (options: Record<string, unknown>) => ({
      ...options,
      useParams,
    }),
    useNavigate,
  };
});

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({ user: { id: "u1", name: "Ada", email: "ada@example.com" }, ready: true }),
}));

vi.mock("@/lib/store", () => ({
  useCourse: () => ({ id: "c1", name: "Algorithms", code: "DAA", mastery: 0 }),
}));

vi.mock("@/lib/queries", () => ({
  useMaterials: () => ({
    data: [
      {
        id: "m1",
        courseId: "c1",
        name: "lecture.pdf",
        type: "pdf",
        kind: "Document",
        meta: "1.0 MB",
        added: "today",
        status: "ready",
        mimeType: "application/pdf",
      },
    ],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useNotes: () => ({
    data: [],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useTranscript: () => ({ data: [], isLoading: false, isError: false }),
  useGenerateNotes: () => ({ mutateAsync: vi.fn(async () => ({})), isPending: false, error: null }),
}));

vi.mock("@/lib/api", () => ({
  api: {
    materials: { url: vi.fn(async () => "blob:file") },
    notes: { pdfUrl: vi.fn(async () => "blob:pdf"), downloadPdf: vi.fn(async () => {}) },
    tutor: { ask: vi.fn(async () => ({ answer: "hi", citations: [], grounded: false })) },
  },
}));

function useDesktopViewport() {
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
}

beforeEach(() => {
  window.localStorage.clear();
  useDesktopViewport();
});

describe("notes page", () => {
  it("shows the notes browser and the tutor side by side", () => {
    render(<Notes />);

    expect(screen.getByText("AI Notes")).toBeInTheDocument();
    expect(screen.getByText("Notes & materials")).toBeInTheDocument();
    expect(screen.getByText("DAA Tutor")).toBeInTheDocument();
  });

  it("offers a generate action scoped to the chosen material", () => {
    render(<Notes />);

    expect(screen.getByRole("button", { name: /Generate Notes/i })).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Choose which material to use" }),
    ).toBeInTheDocument();
  });
});
