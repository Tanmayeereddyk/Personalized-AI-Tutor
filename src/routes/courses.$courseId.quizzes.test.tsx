import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Quizzes } from "./courses.$courseId.quizzes";

vi.mock("@tanstack/react-router", () => {
  const useParams = () => ({ courseId: "c1" });
  return {
    createFileRoute: () => (options: Record<string, unknown>) => ({
      ...options,
      useParams,
    }),
  };
});

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

vi.mock("@/lib/queries", () => ({
  useQuizzes: () => ({
    data: [],
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useCreateQuiz: () => ({ mutateAsync: vi.fn(), isPending: false }),
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
}));

beforeEach(() => {
  window.localStorage.clear();
});

/** Drive the builder from the page CTA up to the full-screen runner. */
function openQuiz(timer = false) {
  render(<Quizzes />);

  fireEvent.click(screen.getByRole("button", { name: /Generate Quiz/i }));

  const materialStep = screen.getByRole("dialog", { name: "Choose a material" });
  fireEvent.click(within(materialStep).getByRole("button", { name: /lecture\.pdf/ }));
  fireEvent.click(within(materialStep).getByRole("button", { name: "Continue" }));

  const configStep = screen.getByRole("dialog", { name: "Configure your quiz" });
  if (timer) {
    fireEvent.click(
      within(configStep).getByRole("switch", { name: "Enable quiz timer" }),
    );
  }
  fireEvent.click(
    within(configStep).getByRole("button", { name: /Generate Quiz/i }),
  );
}

describe("quiz generation flow", () => {
  it("builds a quiz from a saved material and opens the runner", () => {
    openQuiz();

    expect(screen.getByRole("dialog", { name: /Practice Quiz/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Submit Quiz/i })).toBeInTheDocument();
    // Multiple-choice questions render as accessible radios.
    expect(screen.getAllByRole("radio").length).toBeGreaterThan(0);
  });

  it("shows the configuration summary and an optional timer", () => {
    render(<Quizzes />);
    fireEvent.click(screen.getByRole("button", { name: /Generate Quiz/i }));

    const materialStep = screen.getByRole("dialog", { name: "Choose a material" });
    fireEvent.click(
      within(materialStep).getByRole("button", { name: /lecture\.pdf/ }),
    );
    fireEvent.click(within(materialStep).getByRole("button", { name: "Continue" }));

    const configStep = screen.getByRole("dialog", { name: "Configure your quiz" });
    expect(within(configStep).getByText("Number of questions")).toBeInTheDocument();
    expect(within(configStep).getByText("Question types")).toBeInTheDocument();
    expect(within(configStep).getByText(/no timer/)).toBeInTheDocument();

    // The timer is disabled by default and shows its duration when enabled.
    expect(within(configStep).queryByText("Time limit")).not.toBeInTheDocument();
    fireEvent.click(
      within(configStep).getByRole("switch", { name: "Enable quiz timer" }),
    );
    expect(within(configStep).getByText("Time limit")).toBeInTheDocument();
    expect(within(configStep).getByText(/10 minutes/)).toBeInTheDocument();
  });

  it("shows a countdown in the runner when the timer is enabled", () => {
    openQuiz(true);

    expect(screen.getByText(/^\d{2}:\d{2}$/)).toBeInTheDocument();
  });

  it("scores the quiz and shows the review after submitting", () => {
    openQuiz();

    const runner = screen.getByRole("dialog", { name: /Practice Quiz/ });
    // Answer the first question, then submit through the confirmation dialog.
    fireEvent.click(within(runner).getAllByRole("radio")[0]!);
    fireEvent.click(within(runner).getByRole("button", { name: /Submit Quiz/i }));

    const confirm = screen.getByRole("dialog", { name: "Submit this quiz?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Submit Quiz" }));

    expect(screen.getByText("Review")).toBeInTheDocument();
    expect(screen.getByText(/You scored/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Retake/ })).toBeInTheDocument();
  });
});
