import { describe, expect, it } from "vitest";
import { calculateMastery } from "./mastery";
import type { Quiz } from "./types";

const baseQuiz = (id: string, overrides: Partial<Quiz> = {}): Quiz => ({
  id,
  courseId: "course-a",
  name: "Practice",
  topic: "General",
  difficulty: "Medium",
  score: 0,
  total: 0,
  date: "Today",
  source: "ai",
  ...overrides,
});

const result = (id: string, given: string, correct: boolean) => ({ id, given, correct });

describe("calculateMastery", () => {
  it("returns no mastery when there are no eligible attempts", () => {
    expect(calculateMastery([], "course-a")).toBeNull();
    expect(calculateMastery([baseQuiz("empty", { results: [] })], "course-a")).toBeNull();
  });

  it("calculates 80% from eight correct answers among ten answered questions", () => {
    expect(
      calculateMastery(
        [
          baseQuiz("attempt", {
            results: Array.from({ length: 10 }, (_, i) => result(`q${i}`, "answer", i < 8)),
          }),
        ],
        "course-a",
      ),
    ).toEqual({ percent: 80, correct: 8, answered: 10 });
  });

  it("pools underlying answers instead of averaging quiz percentages", () => {
    const quizzes = [
      baseQuiz("large", {
        results: Array.from({ length: 10 }, (_, i) => result(`q${i}`, "answer", i < 8)),
      }),
      baseQuiz("small", { results: [result("q1", "answer", false)] }),
    ];
    expect(calculateMastery(quizzes, "course-a")).toEqual({
      percent: 73,
      correct: 8,
      answered: 11,
    });
  });

  it("includes incorrect answers and excludes unanswered questions", () => {
    expect(
      calculateMastery(
        [
          baseQuiz("attempt", {
            results: [
              result("right", "yes", true),
              result("wrong", "no", false),
              result("blank", "", false),
            ],
          }),
        ],
        "course-a",
      ),
    ).toEqual({ percent: 50, correct: 1, answered: 2 });
  });

  it("shows zero when eligible questions were all answered incorrectly", () => {
    expect(
      calculateMastery(
        [
          baseQuiz("attempt", {
            results: [result("q1", "wrong", false)],
          }),
        ],
        "course-a",
      ),
    ).toEqual({ percent: 0, correct: 0, answered: 1 });
  });

  it("uses saved graded results when a legacy attempt has no source marker", () => {
    expect(
      calculateMastery(
        [baseQuiz("legacy-ai", { source: null, results: [result("q1", "wrong", false)] })],
        "course-a",
      ),
    ).toEqual({ percent: 0, correct: 0, answered: 1 });
  });

  it("ignores duplicate and malformed AI result entries", () => {
    const malformed = {
      id: "bad",
      given: "answer",
      correct: "yes",
    } as unknown as Quiz["results"] extends (infer T)[] | undefined ? T : never;
    expect(
      calculateMastery(
        [
          baseQuiz("attempt", {
            results: [
              result("q1", "wrong", false),
              result("q1", "right", true),
              malformed,
              result("q2", " ", true),
            ],
          }),
        ],
        "course-a",
      ),
    ).toEqual({ percent: 0, correct: 0, answered: 1 });
  });

  it("accepts reliable legacy answer detail, but excludes summary-only attempts", () => {
    expect(
      calculateMastery(
        [
          baseQuiz("legacy", {
            source: "manual",
            score: 8,
            total: 10,
            answers: [
              { questionId: "q1", topicId: null, answered: true, isCorrect: true },
              { questionId: "q2", topicId: null, answered: true, isCorrect: false },
            ],
          }),
          baseQuiz("summary-only", { source: "manual", score: 5, total: 5, answers: undefined }),
        ],
        "course-a",
      ),
    ).toEqual({ percent: 50, correct: 1, answered: 2 });
  });

  it("keeps mastery isolated by course", () => {
    const quizzes = [
      baseQuiz("a", { results: [result("q1", "yes", true)] }),
      baseQuiz("b", { courseId: "course-b", results: [result("q2", "no", false)] }),
    ];
    expect(calculateMastery(quizzes, "course-a")).toEqual({
      percent: 100,
      correct: 1,
      answered: 1,
    });
    expect(calculateMastery(quizzes, "course-b")).toEqual({ percent: 0, correct: 0, answered: 1 });
  });
});
