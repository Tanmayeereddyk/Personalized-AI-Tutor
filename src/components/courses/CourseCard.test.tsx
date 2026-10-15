import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { CourseCard } from "./CourseCard";

const state = vi.hoisted(() => ({ quizzes: [] as unknown[], isLoading: false, isError: false }));

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="/course">{children}</a>,
}));

vi.mock("@/lib/queries", () => ({
  useQuizzes: () => ({ data: state.quizzes, isLoading: state.isLoading, isError: state.isError }),
}));

const course = {
  id: "course-a",
  name: "Algorithms",
  code: "ALG",
  color: "mint" as const,
  icon: "book" as const,
  mastery: 0,
  topicCount: 2,
  materialCount: 1,
};

describe("CourseCard mastery", () => {
  it("shows the pooled result used on both the Courses page and Dashboard", () => {
    state.quizzes = [
      {
        id: "attempt",
        courseId: "course-a",
        name: "Practice",
        topic: "General",
        difficulty: "Medium",
        score: 8,
        total: 10,
        date: "Today",
        source: "ai",
        results: Array.from({ length: 10 }, (_, index) => ({
          id: `q${index}`,
          given: "answer",
          correct: index < 8,
        })),
      },
    ];
    state.isLoading = false;
    state.isError = false;

    render(<CourseCard course={course} />);

    expect(screen.getByText("Overall mastery").parentElement).toHaveTextContent("80%");
  });

  it("shows Not attempted when no answer-level data qualifies", () => {
    state.quizzes = [
      {
        id: "legacy",
        courseId: "course-a",
        name: "Old attempt",
        topic: "General",
        difficulty: "Medium",
        score: 8,
        total: 10,
        date: "Today",
        source: "manual",
      },
    ];
    state.isLoading = false;
    state.isError = false;

    render(<CourseCard course={course} />);

    expect(screen.getByText("Not attempted")).toBeInTheDocument();
  });
});
