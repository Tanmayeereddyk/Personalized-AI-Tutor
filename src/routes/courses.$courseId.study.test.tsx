import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LayoutProvider } from "@/lib/layout";
import { StudyWorkspace } from "./courses.$courseId.study";

vi.mock("@tanstack/react-router", () => {
  const useParams = () => ({ courseId: "c1" });
  const useSearch = () => ({ material: undefined as string | undefined });
  const useNavigate = () => vi.fn();
  const Link = ({
    children,
    to: _to,
    params: _params,
    search: _search,
    ...rest
  }: {
    children?: unknown;
    to?: unknown;
    params?: unknown;
    search?: unknown;
    [key: string]: unknown;
  }) => (
    <a href="#" {...rest}>
      {children as never}
    </a>
  );
  return {
    createFileRoute: () => (options: Record<string, unknown>) => ({
      ...options,
      useParams,
      useSearch,
    }),
    Link,
    useNavigate,
  };
});

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { id: "u1", name: "Ada", role: "student", email: "ada@example.com" },
    ready: true,
  }),
}));

vi.mock("@/lib/store", () => ({
  useCourse: () => ({
    id: "c1",
    name: "Algorithms",
    code: "DAA",
    color: "mint",
    icon: "sigma",
    mastery: 0,
    topicCount: 0,
    materialCount: 1,
  }),
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
    data: [
      {
        id: "n1",
        courseId: "c1",
        title: "Graphs summary",
        content: "Adjacency lists…",
        topics: ["Graphs"],
        updated: "today",
      },
    ],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useGenerateNotes: () => ({ mutateAsync: vi.fn(async () => ({})), isPending: false }),
  useExtractionStatus: () => ({ data: { status: "ready", stage: null, warnings: [] } }),
  useTranscript: () => ({ data: [], isLoading: false, isError: false }),
}));

vi.mock("@/lib/api", () => ({
  api: {
    materials: { url: vi.fn(async () => "blob:file") },
    notes: { generate: vi.fn(async () => ({})) },
    tutor: { ask: vi.fn(async () => ({ answer: "hi", citations: [] })) },
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

describe("study workspace layouts", () => {
  it("shows the material reader and the notes panel side by side by default", async () => {
    render(<StudyWorkspace />);

    expect(await screen.findByText("Private · link expires")).toBeInTheDocument();
    expect(screen.getByText("Notes & materials")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Study layout" })).toBeInTheDocument();
    // The tutor is not part of the default layout.
    expect(screen.queryByText("DAA Tutor")).not.toBeInTheDocument();
  });

  it("hides the material reader in notes-only mode", async () => {
    render(<StudyWorkspace />);
    await screen.findByText("Private · link expires");

    fireEvent.click(screen.getByTitle("Notes only"));

    await waitFor(() =>
      expect(screen.queryByText("Private · link expires")).not.toBeInTheDocument(),
    );
    expect(screen.getByText("Notes & materials")).toBeInTheDocument();
  });

  it("shows the tutor in notes + tutor mode", async () => {
    render(<StudyWorkspace />);
    await screen.findByText("Private · link expires");

    fireEvent.click(screen.getByTitle("Notes + Tutor"));

    expect(await screen.findByText("DAA Tutor")).toBeInTheDocument();
    expect(screen.getByText("Notes & materials")).toBeInTheDocument();
    expect(screen.queryByText("Private · link expires")).not.toBeInTheDocument();
  });

  it("remembers the chosen layout", async () => {
    render(<StudyWorkspace />);
    await screen.findByText("Private · link expires");

    fireEvent.click(screen.getByTitle("Notes + Tutor"));

    expect(window.localStorage.getItem("studyai.study.mode")).toBe("notes-tutor");
  });

  it("opens the workspace as a full screen page and closes it", async () => {
    render(
      <LayoutProvider>
        <StudyWorkspace />
      </LayoutProvider>,
    );
    await screen.findByText("Private · link expires");

    expect(screen.queryByLabelText("Close full screen")).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Full screen"));
    expect(screen.getByLabelText("Close full screen")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Close full screen"));
    expect(screen.queryByLabelText("Close full screen")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Full screen")).toBeInTheDocument();
  });
});
