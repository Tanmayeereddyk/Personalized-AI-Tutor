import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api } from "@/lib/api";
import { TutorWorkspace } from "./TutorWorkspace";

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
    materialCount: 0,
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
}));

vi.mock("@/lib/api", () => ({
  api: {
    materials: { url: vi.fn(async () => "https://example.com/file.pdf") },
    tutor: {
      ask: vi.fn(async () => ({
        answer: "Grounded answer from your materials.",
        citations: [
          {
            kind: "pdf",
            label: "p. 1",
            materialId: "m1",
            materialName: "Notes.pdf",
            page: 1,
          },
        ],
        grounded: true,
        usedMaterials: ["m1"],
      })),
    },
  },
}));

const sendMessage = (text: string) => {
  const textarea = screen.getByLabelText("Message the tutor");
  fireEvent.change(textarea, { target: { value: text } });
  const form = textarea.closest("form");
  expect(form).not.toBeNull();
  fireEvent.submit(form as HTMLFormElement);
};

describe("TutorWorkspace", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows the tutor full width when no notes are open", () => {
    render(<TutorWorkspace courseId="c1" />);
    expect(screen.getByLabelText("Message the tutor")).toBeInTheDocument();
    expect(screen.queryByText("Notes & materials")).not.toBeInTheDocument();
    // The divider only exists while both panels are visible.
    expect(screen.queryByLabelText("Resize notes and tutor panels")).not.toBeInTheDocument();
  });

  it("shows notes on the left and the tutor on the right once notes are opened", () => {
    render(<TutorWorkspace courseId="c1" />);
    fireEvent.click(screen.getByLabelText("Show notes panel"));

    expect(screen.getByText("Notes & materials")).toBeInTheDocument();
    expect(screen.getByLabelText("Message the tutor")).toBeInTheDocument();
    expect(screen.getByLabelText("Resize notes and tutor panels")).toBeInTheDocument();
  });

  it("expands the tutor back to full width when notes are closed", () => {
    render(<TutorWorkspace courseId="c1" />);
    fireEvent.click(screen.getByLabelText("Show notes panel"));
    expect(screen.getByText("Notes & materials")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Close notes panel"));

    expect(screen.queryByText("Notes & materials")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Resize notes and tutor panels")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Message the tutor")).toBeInTheDocument();
  });

  it("collapses the tutor without breaking the workspace, and reopens it", () => {
    render(<TutorWorkspace courseId="c1" />);
    fireEvent.click(screen.getByLabelText("Collapse tutor panel"));

    expect(screen.getByText("The tutor is hidden")).toBeInTheDocument();
    expect(screen.queryByLabelText("Message the tutor")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Open tutor"));
    expect(screen.getByLabelText("Message the tutor")).toBeInTheDocument();
  });

  it("keeps the conversation when the notes panel is toggled", async () => {
    render(<TutorWorkspace courseId="c1" />);

    sendMessage("Explain dynamic programming");
    expect(screen.getByText("Explain dynamic programming")).toBeInTheDocument();

    // The grounded reply comes back from the tutor endpoint, with its sources.
    expect(await screen.findByText(/Grounded answer from your materials/)).toBeInTheDocument();
    expect(screen.getByText(/Notes\.pdf/)).toBeInTheDocument();

    // Toggling the notes panel must not clear the conversation.
    fireEvent.click(screen.getByLabelText("Show notes panel"));
    expect(screen.getByText("Explain dynamic programming")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Close notes panel"));
    expect(screen.getByText("Explain dynamic programming")).toBeInTheDocument();
  });

  it("remembers the conversation for the course across remounts", () => {
    vi.useFakeTimers();
    const first = render(<TutorWorkspace courseId="c1" />);
    sendMessage("Remember this");
    act(() => {
      vi.advanceTimersByTime(700);
    });
    first.unmount();

    render(<TutorWorkspace courseId="c1" />);
    expect(screen.getByText("Remember this")).toBeInTheDocument();
  });

  it("offers a retry after a failure and re-asks the same question", async () => {
    const ask = vi.mocked(api.tutor.ask);
    ask.mockClear();
    ask.mockRejectedValueOnce(
      new Error("The AI service is temporarily busy. Please try again shortly."),
    );

    render(<TutorWorkspace courseId="c1" />);
    sendMessage("Explain dynamic programming");

    // The failure shows as a system message with a retry action — never a
    // made-up answer.
    expect(await screen.findByText(/temporarily busy/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Retry/i }));

    // The retry re-asks the same question and then shows the grounded answer.
    expect(await screen.findByText(/Grounded answer from your materials/)).toBeInTheDocument();
    expect(ask).toHaveBeenCalledTimes(2);
    expect(ask.mock.calls[1]?.[1]).toMatchObject({ question: "Explain dynamic programming" });
  });
});
