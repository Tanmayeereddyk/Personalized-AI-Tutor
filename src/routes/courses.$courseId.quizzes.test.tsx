import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";

import type { QuizAttemptResult, QuizSubmission } from "@/lib/quiz";
import type { Quiz } from "@/lib/types";
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

const mocks = vi.hoisted(() => {
  /** A minimal generated quiz; the timer is mirrored from the request. */
  const quizFor = (timerMinutes: number | null) => ({
    id: "quiz-1",
    setId: "quiz-1",
    courseId: "c1",
    title: "Photosynthesis — Practice Quiz",
    scopeLabel: "Photosynthesis",
    topicIds: ["t1"],
    topicNames: ["Photosynthesis"],
    difficulty: "Medium",
    questionTypes: ["multiple-choice"] as const,
    timerMinutes,
    generatedAt: "2024-01-01T00:00:00.000Z",
    questions: [
      {
        id: "q1",
        type: "multiple-choice" as const,
        prompt: "What does photosynthesis convert?",
        options: ["Light energy", "Sound energy", "Heat only"],
        correctAnswer: "Light energy",
        explanation: "The source says photosynthesis converts light energy.",
        source: { label: "Page 1", materialName: "lecture.pdf", snippet: "…light…" },
      },
      {
        id: "q2",
        type: "true-false" as const,
        prompt: "Plants store chemical energy.",
        correctAnswer: "True",
        explanation: "The source states chemical energy is stored.",
        source: { label: "Page 1", materialName: "lecture.pdf", snippet: "…energy…" },
      },
    ],
  });

  /** Grade a submission the same way the backend does, for the mocked hook. */
  const resultFor = (input: {
    setId: string;
    submission: {
      answers: { questionId: string; answer: string }[];
      timeTakenSeconds: number | null;
      clientToken: string;
    };
  }): QuizAttemptResult => {
    const quiz = quizFor(null);
    const given = new Map(input.submission.answers.map((a) => [a.questionId, a.answer]));
    const results = quiz.questions.map((q) => {
      const answer = given.get(q.id) ?? "";
      const expected = (q.correctAnswer ?? "").trim().toLowerCase();
      const correct = answer.trim() !== "" && answer.trim().toLowerCase() === expected;
      return {
        id: q.id,
        type: q.type,
        prompt: q.prompt,
        options: q.options,
        given: answer,
        correct,
        correctAnswer: q.correctAnswer ?? "",
        explanation: q.explanation ?? "",
        source: q.source,
      };
    });
    const score = results.filter((r) => r.correct).length;
    return {
      id: "attempt-1",
      courseId: "c1",
      quizSetId: "quiz-1",
      title: quiz.title,
      scopeLabel: quiz.scopeLabel,
      difficulty: "Medium",
      questionTypes: ["multiple-choice"],
      timerMinutes: null,
      score,
      total: results.length,
      percentage: results.length ? Math.round((score / results.length) * 100) : 0,
      source: "ai",
      submittedAt: "2024-01-01T00:00:00.000Z",
      createdAt: "2024-01-01T00:00:00.000Z",
      results,
    };
  };

  return {
    quizFor,
    resultFor,
    topics: [
      {
        id: "t1",
        courseId: "c1",
        name: "Photosynthesis",
        description: "Light energy into chemical energy.",
        resources: 1,
        sourceMaterialIds: ["m1"],
        generated: true,
      },
      {
        id: "t2",
        courseId: "c1",
        name: "Cell Division",
        description: "One cell becomes two.",
        resources: 1,
        sourceMaterialIds: ["m1"],
        generated: true,
      },
    ],
    generateState: {
      mutate: vi.fn(),
      reset: vi.fn(),
      isPending: false,
      isError: false,
      error: null as unknown,
    },
    deleteState: {
      mutateAsync: vi.fn<(id: string) => Promise<void>>(async () => undefined),
      isPending: false,
      variables: undefined as string | undefined,
    },
    // The submit mutation the runner calls; defaults to grading in the mock.
    submitState: {
      mutateAsync: vi.fn<
        (input: { setId: string; submission: QuizSubmission }) => Promise<QuizAttemptResult>
      >(async (input) => resultFor(input)),
    },
    // Saved attempts shown in the list (returned by the mocked useQuizzes).
    savedQuizzes: [] as Quiz[],
    // The saved result the review modal fetches (mocked useQuizResult).
    resultState: {
      data: undefined as QuizAttemptResult | undefined,
      isLoading: false,
      isError: false,
      error: null as unknown,
      refetch: vi.fn(),
    },
  };
});

vi.mock("@/lib/queries", () => ({
  useQuizzes: () => ({
    data: mocks.savedQuizzes,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useCreateQuiz: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteQuiz: () => mocks.deleteState,
  useTopics: () => ({
    data: mocks.topics,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useGenerateQuiz: () => mocks.generateState,
  useSubmitQuiz: () => ({ mutateAsync: mocks.submitState.mutateAsync, isPending: false }),
  useQuizResult: () => mocks.resultState,
}));

beforeEach(() => {
  window.localStorage.clear();
  mocks.savedQuizzes = [];
  mocks.deleteState.mutateAsync = vi.fn<(id: string) => Promise<void>>(async () => undefined);
  mocks.deleteState.isPending = false;
  mocks.deleteState.variables = undefined;
  mocks.generateState.isPending = false;
  mocks.generateState.isError = false;
  mocks.generateState.error = null;
  mocks.generateState.reset = vi.fn();
  mocks.generateState.mutate = vi.fn((input, options) => {
    options?.onSuccess?.(mocks.quizFor(input.config.timerMinutes));
  });
  mocks.submitState.mutateAsync = vi.fn<
    (input: { setId: string; submission: QuizSubmission }) => Promise<QuizAttemptResult>
  >(async (input) => mocks.resultFor(input));
  mocks.resultState.data = undefined;
  mocks.resultState.isLoading = false;
  mocks.resultState.isError = false;
  mocks.resultState.error = null;
  mocks.resultState.refetch = vi.fn();
});

/** Drive the builder from the page CTA up to the full-screen runner. */
function openQuiz(timer = false, topicName = /Photosynthesis/) {
  render(<Quizzes />);

  fireEvent.click(screen.getAllByRole("button", { name: /Generate Quiz/i })[0]!);

  const topicsStep = screen.getByRole("dialog", { name: "Choose topics" });
  fireEvent.click(within(topicsStep).getByRole("checkbox", { name: topicName }));
  fireEvent.click(within(topicsStep).getByRole("button", { name: "Continue" }));

  const configStep = screen.getByRole("dialog", { name: "Configure your quiz" });
  if (timer) {
    fireEvent.click(within(configStep).getByRole("switch", { name: "Enable quiz timer" }));
  }
  fireEvent.click(within(configStep).getByRole("button", { name: /Generate Quiz/i }));
}

describe("quiz generation flow", () => {
  it("lists topics as checkboxes and generates an AI quiz", () => {
    openQuiz();

    expect(screen.getByRole("dialog", { name: /Practice Quiz/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Submit Quiz/i })).toBeInTheDocument();
    // Multiple-choice questions render as accessible radios.
    expect(screen.getAllByRole("radio").length).toBeGreaterThan(0);
    // The generation call received the selected topic id.
    expect(mocks.generateState.mutate).toHaveBeenCalledTimes(1);
    const [input] = mocks.generateState.mutate.mock.calls[0]!;
    expect(input.topicIds).toEqual(["t1"]);
  });

  it("sends every selected topic to the backend", () => {
    render(<Quizzes />);
    fireEvent.click(screen.getAllByRole("button", { name: /Generate Quiz/i })[0]!);

    const topicsStep = screen.getByRole("dialog", { name: "Choose topics" });
    fireEvent.click(within(topicsStep).getByRole("checkbox", { name: /Photosynthesis/ }));
    fireEvent.click(within(topicsStep).getByRole("checkbox", { name: /Cell Division/ }));
    fireEvent.click(within(topicsStep).getByRole("button", { name: "Continue" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Configure your quiz" })).getByRole("button", {
        name: /Generate Quiz/i,
      }),
    );

    const [input] = mocks.generateState.mutate.mock.calls[0]!;
    expect(input.topicIds).toEqual(["t1", "t2"]);
  });

  it("shows the configuration summary and an optional timer", () => {
    render(<Quizzes />);
    fireEvent.click(screen.getAllByRole("button", { name: /Generate Quiz/i })[0]!);

    const topicsStep = screen.getByRole("dialog", { name: "Choose topics" });
    fireEvent.click(within(topicsStep).getByRole("checkbox", { name: /Photosynthesis/ }));
    fireEvent.click(within(topicsStep).getByRole("button", { name: "Continue" }));

    const configStep = screen.getByRole("dialog", { name: "Configure your quiz" });
    expect(within(configStep).getByText("Number of questions")).toBeInTheDocument();
    expect(within(configStep).getByText("Question types")).toBeInTheDocument();
    expect(within(configStep).getByText(/no timer/)).toBeInTheDocument();

    // The timer is disabled by default and shows its duration when enabled.
    expect(within(configStep).queryByText("Time limit")).not.toBeInTheDocument();
    fireEvent.click(within(configStep).getByRole("switch", { name: "Enable quiz timer" }));
    expect(within(configStep).getByText("Time limit")).toBeInTheDocument();
    expect(within(configStep).getByText(/10 minutes/)).toBeInTheDocument();
  });

  it("shows a countdown in the runner when the timer is enabled", () => {
    openQuiz(true);

    expect(screen.getByText(/^\d{2}:\d{2}$/)).toBeInTheDocument();
  });

  it("scores the quiz and shows the review after submitting", async () => {
    openQuiz();

    const runner = screen.getByRole("dialog", { name: /Practice Quiz/ });
    // Answer the first question, then submit through the confirmation dialog.
    fireEvent.click(within(runner).getAllByRole("radio")[0]!);
    fireEvent.click(within(runner).getByRole("button", { name: /Submit Quiz/i }));

    const confirm = screen.getByRole("dialog", { name: "Submit this quiz?" });
    fireEvent.click(within(confirm).getByRole("button", { name: "Submit Quiz" }));

    // The attempt is graded and saved on the backend before the review shows.
    expect(await screen.findByText("Review")).toBeInTheDocument();
    expect(screen.getByText(/You scored/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Retake/ })).toBeInTheDocument();
    expect(mocks.submitState.mutateAsync).toHaveBeenCalledTimes(1);
  });

  it("shows a loading state and prevents duplicate submissions", () => {
    mocks.generateState.isPending = true;
    render(<Quizzes />);
    fireEvent.click(screen.getAllByRole("button", { name: /Generate Quiz/i })[0]!);

    const topicsStep = screen.getByRole("dialog", { name: "Choose topics" });
    fireEvent.click(within(topicsStep).getByRole("checkbox", { name: /Photosynthesis/ }));
    fireEvent.click(within(topicsStep).getByRole("button", { name: "Continue" }));

    const configStep = screen.getByRole("dialog", { name: "Configure your quiz" });
    const generateButton = within(configStep).getByRole("button", { name: /Generating/ });
    expect(generateButton).toBeDisabled();
    expect(within(configStep).getByText(/Generating questions with AI/)).toBeInTheDocument();
  });

  it("shows the backend error and allows a retry", () => {
    mocks.generateState.isError = true;
    mocks.generateState.error = new Error("The language model is not configured.");
    render(<Quizzes />);
    fireEvent.click(screen.getAllByRole("button", { name: /Generate Quiz/i })[0]!);

    const topicsStep = screen.getByRole("dialog", { name: "Choose topics" });
    fireEvent.click(within(topicsStep).getByRole("checkbox", { name: /Photosynthesis/ }));
    fireEvent.click(within(topicsStep).getByRole("button", { name: "Continue" }));

    const configStep = screen.getByRole("dialog", { name: "Configure your quiz" });
    expect(within(configStep).getByRole("alert")).toHaveTextContent(
      "The language model is not configured.",
    );
    // The failed request can be retried.
    expect(within(configStep).getByRole("button", { name: /Try again/i })).toBeEnabled();
  });
});

describe("quiz history", () => {
  const aiQuiz = (): Quiz => ({
    id: "quiz-ai",
    courseId: "c1",
    name: "Photosynthesis — Practice Quiz",
    topic: "Photosynthesis",
    difficulty: "Medium",
    score: 1,
    total: 2,
    percentage: 50,
    date: "today",
    source: "ai",
  });

  it("lists an attempt with its score and reopens the saved result", async () => {
    mocks.savedQuizzes = [aiQuiz()];
    mocks.resultState.data = mocks.resultFor({
      setId: "quiz-1",
      submission: {
        answers: [{ questionId: "q1", answer: "Light energy" }],
        timeTakenSeconds: null,
        clientToken: "t",
      },
    });
    render(<Quizzes />);

    // One compact row: title, score and percentage.
    expect(screen.getByText("Quiz History")).toBeInTheDocument();
    expect(screen.getByText("Photosynthesis — Practice Quiz")).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();

    // Opening the row shows the saved answers, answer key and explanations.
    fireEvent.click(screen.getByRole("button", { name: "Open Photosynthesis — Practice Quiz" }));
    expect(await screen.findByText(/You scored/)).toBeInTheDocument();
  });

  it("shows only a score note for a manually recorded attempt", () => {
    mocks.savedQuizzes = [
      { ...aiQuiz(), id: "quiz-manual", name: "Midterm practice", source: "manual" },
    ];
    render(<Quizzes />);

    fireEvent.click(screen.getByRole("button", { name: "Open Midterm practice" }));
    expect(screen.getByText(/recorded manually/)).toBeInTheDocument();
  });
});

describe("quiz deletion", () => {
  const savedQuiz = (): Quiz => ({
    id: "quiz-a",
    courseId: "c1",
    name: "Midterm practice",
    topic: "Photosynthesis",
    difficulty: "Medium",
    score: 3,
    total: 5,
    date: "today",
  });

  it("asks for confirmation before deleting a saved quiz", () => {
    mocks.savedQuizzes = [savedQuiz()];
    render(<Quizzes />);

    fireEvent.click(screen.getByRole("button", { name: "Delete Midterm practice" }));

    const dialog = screen.getByRole("dialog", { name: "Delete this quiz?" });
    expect(dialog).toBeInTheDocument();
    // Nothing is deleted until the user confirms.
    expect(mocks.deleteState.mutateAsync).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(mocks.deleteState.mutateAsync).not.toHaveBeenCalled();
    expect(screen.getByText("Midterm practice")).toBeInTheDocument();
  });

  it("removes the quiz from the list once the backend confirms", async () => {
    mocks.savedQuizzes = [savedQuiz()];
    mocks.deleteState.mutateAsync = vi.fn(async (id: string) => {
      // The real hook drops the row from the cache on success.
      mocks.savedQuizzes = mocks.savedQuizzes.filter((quiz) => quiz.id !== id);
    });
    render(<Quizzes />);

    fireEvent.click(screen.getByRole("button", { name: "Delete Midterm practice" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Delete this quiz?" })).getByRole("button", {
        name: "Delete quiz",
      }),
    );

    await waitFor(() =>
      expect(screen.queryByText("Midterm practice")).not.toBeInTheDocument(),
    );
    expect(mocks.deleteState.mutateAsync).toHaveBeenCalledWith("quiz-a");
    expect(vi.mocked(toast.success)).toHaveBeenCalledWith("Quiz attempt deleted.");
  });

  it("keeps the quiz and shows an error when deletion fails", async () => {
    mocks.savedQuizzes = [savedQuiz()];
    mocks.deleteState.mutateAsync = vi.fn(async () => {
      throw new Error("Could not delete the quiz.");
    });
    render(<Quizzes />);

    fireEvent.click(screen.getByRole("button", { name: "Delete Midterm practice" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Delete this quiz?" })).getByRole("button", {
        name: "Delete quiz",
      }),
    );

    await waitFor(() =>
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith("Could not delete the quiz."),
    );
    // The confirmation stays open and the quiz is still listed.
    expect(screen.getByRole("dialog", { name: "Delete this quiz?" })).toBeInTheDocument();
    expect(screen.getByText("Midterm practice")).toBeInTheDocument();
  });
});
