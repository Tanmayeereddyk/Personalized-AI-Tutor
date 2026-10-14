import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api";
import { Topics } from "./courses.$courseId.topics";

/**
 * Mutable mock state. The component reads it at render time, so
 * each test sets the scenario it needs before rendering.
 */
const state = vi.hoisted(() => ({
  hash: "",
  navigate: vi.fn(),
  topics: {
    data: [] as unknown[],
    isLoading: false,
    isError: false,
    error: null as Error | null,
    refetch: vi.fn(),
  },
  materials: {
    data: [] as unknown[],
    isLoading: false,
    isError: false,
    error: null as Error | null,
    refetch: vi.fn(),
  },
  generate: {
    mutateAsync: vi.fn(async () => []),
    isPending: false,
    error: null as Error | null,
  },
  refresh: {
    mutateAsync: vi.fn(async () => []),
    isPending: false,
    error: null as Error | null,
  },
}));

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    ...options,
    useParams: () => ({ courseId: "c1" }),
  }),
  useNavigate: () => state.navigate,
  useRouterState: (opts: {
    select: (s: { location: { hash: string } }) => unknown;
  }) => opts.select({ location: { hash: state.hash } }),
  // An <a> needs an href to expose the "link" role to
  // testing-library's getByRole("link").
  Link: ({ children }: { children: ReactNode }) => <a href="/">{children}</a>,
}));

vi.mock("@/lib/auth", () => ({
  useAuth: () => ({
    user: { id: "u1", name: "Ada", email: "ada@example.com" },
    ready: true,
  }),
}));

vi.mock("@/lib/api", () => ({
  ApiError: class ApiError extends Error {
    status: number;
    constructor(status: number, message: string) {
      super(message);
      this.name = "ApiError";
      this.status = status;
    }
  },
}));

vi.mock("@/lib/queries", () => ({
  useTopics: () => state.topics,
  useMaterials: () => state.materials,
  useGenerateTopics: () => state.generate,
  useRefreshTopics: () => state.refresh,
}));

const material = (id: string, name: string) => ({
  id,
  courseId: "c1",
  name,
  type: "pdf",
  kind: "Document",
  meta: "1.0 MB",
  added: "today",
  status: "ready",
  mimeType: "application/pdf",
});

const topic = {
  id: "t1",
  courseId: "c1",
  name: "Graph traversal",
  description: "BFS and DFS over adjacency lists.",
  group: "Graphs",
  prerequisite: "Graph representation",
  resources: 2,
  sourceMaterialIds: ["m1", "m2"],
  generated: true,
  generationMethod: "llm",
  createdAt: undefined,
  updatedAt: "2026-10-12T09:00:00Z",
};

beforeEach(() => {
  window.localStorage.clear();
  state.hash = "";
  state.navigate.mockClear();
  state.topics = {
    data: [],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  };
  state.materials = {
    data: [],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  };
  state.generate = {
    mutateAsync: vi.fn(async () => []),
    isPending: false,
    error: null,
  };
  state.refresh = {
    mutateAsync: vi.fn(async () => []),
    isPending: false,
    error: null,
  };
});

describe("topics page", () => {
  it("shows a loading state while topics are fetched", () => {
    state.topics.isLoading = true;
    render(<Topics />);
    expect(screen.getByText("Loading topics…")).toBeInTheDocument();
  });

  it("shows an error with a retry action when loading fails", () => {
    state.topics.isError = true;
    state.topics.error = new Error("Cannot reach the server.");
    render(<Topics />);

    expect(screen.getByText("Couldn't load topics")).toBeInTheDocument();
    expect(screen.getByText("Cannot reach the server.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Try again/i }));
    expect(state.topics.refetch).toHaveBeenCalledTimes(1);
  });

  it("explains that materials come first when the course has none", () => {
    state.materials.data = [];
    render(<Topics />);

    expect(screen.getByText("No materials yet")).toBeInTheDocument();
    // The body text continues past this phrase, so match by prefix.
    expect(
      screen.getByText(/Upload slides, PDFs or lecture videos first/),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Add materials/i })).toBeInTheDocument();
  });

  it("offers generation when materials exist but no topics were generated", () => {
    state.materials.data = [material("m1", "biology.pdf")];
    render(<Topics />);

    expect(screen.getByText("No topics yet")).toBeInTheDocument();
    // The header and the empty state both offer generation.
    expect(
      screen.getAllByRole("button", { name: /Generate Topics/i }).length,
    ).toBeGreaterThan(0);
    // Opening the page must never trigger generation by itself.
    expect(state.generate.mutateAsync).not.toHaveBeenCalled();
  });

  it("renders topics with descriptions, groups and source names", () => {
    state.materials.data = [
      material("m1", "biology.pdf"),
      material("m2", "slides.pdf"),
    ];
    state.topics.data = [topic];
    render(<Topics />);

    expect(screen.getByText("Graph traversal")).toBeInTheDocument();
    expect(
      screen.getByText("BFS and DFS over adjacency lists."),
    ).toBeInTheDocument();
    expect(screen.getByText("Graphs")).toBeInTheDocument();
    expect(screen.getByText("AI")).toBeInTheDocument();
    expect(screen.getByText("2 materials")).toBeInTheDocument();
  });

  it("expands a detail panel for the topic selected in the URL hash", () => {
    state.hash = "t1";
    state.materials.data = [
      material("m1", "biology.pdf"),
      material("m2", "slides.pdf"),
    ];
    state.topics.data = [topic];
    render(<Topics />);

    expect(screen.getByText("Source materials")).toBeInTheDocument();
    expect(screen.getByText("biology.pdf")).toBeInTheDocument();
    expect(screen.getByText("slides.pdf")).toBeInTheDocument();
    expect(screen.getByText("Generated by llm")).toBeInTheDocument();
    expect(
      screen.getByText("Needs Graph representation"),
    ).toBeInTheDocument();
  });

  it("toggles the detail panel through the URL hash when a topic is clicked", () => {
    state.materials.data = [material("m1", "biology.pdf")];
    state.topics.data = [topic];
    render(<Topics />);

    fireEvent.click(screen.getByRole("button", { name: /Graph traversal/i }));
    expect(state.navigate).toHaveBeenCalledWith(
      expect.objectContaining({ hash: "t1", replace: true }),
    );
  });

  it("generates topics when the Generate button is clicked", () => {
    state.materials.data = [material("m1", "biology.pdf")];
    render(<Topics />);

    const buttons = screen.getAllByRole("button", {
      name: /Generate Topics/i,
    });
    fireEvent.click(buttons[0]!);
    expect(state.generate.mutateAsync).toHaveBeenCalledTimes(1);
    expect(state.generate.mutateAsync).toHaveBeenCalledWith();
  });

  it("refreshes topics when the map already exists", () => {
    state.materials.data = [material("m1", "biology.pdf")];
    state.topics.data = [topic];
    render(<Topics />);

    expect(
      screen.getByRole("button", { name: /Refresh Topics/i }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Refresh Topics/i }));
    expect(state.refresh.mutateAsync).toHaveBeenCalledTimes(1);
  });

  it("disables the action button while a request is running", () => {
    state.materials.data = [material("m1", "biology.pdf")];
    state.generate.isPending = true;
    render(<Topics />);

    const buttons = screen.getAllByRole("button", {
      name: /Generating…/i,
    });
    expect(buttons.length).toBeGreaterThan(0);
    for (const button of buttons) {
      expect(button).toBeDisabled();
    }
  });

  it("shows generation failures inline, including the LLM-not-configured case", () => {
    state.materials.data = [material("m1", "biology.pdf")];
    state.generate.error = new Error(
      "The language model is not configured, so notes and tutor answers cannot be generated.",
    );
    render(<Topics />);

    expect(
      screen.getByText(
        "The language model is not configured, so notes and tutor answers cannot be generated.",
      ),
    ).toBeInTheDocument();
  });

  it("links to materials when generation fails because nothing is indexed", () => {
    state.materials.data = [material("m1", "biology.pdf")];
    state.generate.error = new ApiError(
      400,
      "No indexed content yet — extract your materials and build their index first, then generate topics.",
    );
    render(<Topics />);

    expect(screen.getByText(/No indexed content yet/)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Manage materials/i }),
    ).toBeInTheDocument();
  });
});
