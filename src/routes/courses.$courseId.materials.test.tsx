import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Materials } from "./courses.$courseId.materials";

vi.mock("@tanstack/react-router", () => {
  const useParams = () => ({ courseId: "c1" });
  const useNavigate = () => vi.fn();
  // The page carries the open material in the URL hash.
  const useRouterState = ({ select }: { select: (s: unknown) => unknown }) =>
    select({ location: { hash: "" } });
  return {
    createFileRoute: () => (options: Record<string, unknown>) => ({
      ...options,
      useParams,
    }),
    useNavigate,
    useRouterState,
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
  useUploadMaterials: () => ({ mutateAsync: vi.fn(async () => []), isPending: false }),
  useGenerateNotes: () => ({ mutateAsync: vi.fn(async () => ({})), isPending: false, error: null }),
  useDeleteMaterial: () => ({ mutateAsync: vi.fn(async () => {}), isPending: false }),
  useExtractionStatus: () => ({ data: { status: "ready", stage: null, warnings: [] } }),
  useTranscript: () => ({ data: [], isLoading: false, isError: false }),
  useNotes: () => ({
    data: [],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useDeleteNote: () => ({ mutateAsync: vi.fn(async () => {}), isPending: false }),
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

describe("materials page", () => {
  it("opens the selected material beside the tutor", async () => {
    render(<Materials />);

    expect(screen.getByText("Course Materials")).toBeInTheDocument();
    // The reader fetches a temporary link and renders the file inline.
    expect(await screen.findByTitle("lecture.pdf")).toBeInTheDocument();
    expect(screen.getByText("DAA Tutor")).toBeInTheDocument();
  });

  it("keeps an upload button and a material picker on the page", () => {
    render(<Materials />);

    expect(screen.getByRole("button", { name: /Add Files/i })).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: "Choose which material to open" }),
    ).toBeInTheDocument();
  });
});
