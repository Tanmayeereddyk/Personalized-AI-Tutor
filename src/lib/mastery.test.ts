import { describe, expect, it } from "vitest";
import { calculateMastery } from "./mastery";
import type { Quiz } from "./types";

const quiz = (id: string, answers: NonNullable<Quiz["answers"]>): Quiz => ({
  id, courseId: "course", name: "Practice", topic: "General", difficulty: "Medium",
  score: 0, total: answers.length, date: "Today", answers,
});

describe("calculateMastery", () => {
  it("pools correct and incorrect answers across attempts", () => {
    const result = calculateMastery([
      quiz("a", [
        { questionId: "1", topicId: "t1", answered: true, isCorrect: true },
        { questionId: "2", topicId: "t1", answered: true, isCorrect: false },
      ]),
      quiz("b", [{ questionId: "1", topicId: "t2", answered: true, isCorrect: true }]),
    ]);
    expect(result).toEqual({ percent: 67, correct: 2, answered: 3 });
    expect(calculateMastery([
      quiz("a", [
        { questionId: "1", topicId: "t1", answered: true, isCorrect: true },
        { questionId: "2", topicId: "t1", answered: true, isCorrect: false },
      ]),
      quiz("b", [{ questionId: "1", topicId: "t2", answered: true, isCorrect: true }]),
    ], "t1")).toEqual({ percent: 50, correct: 1, answered: 2 });
  });

  it("excludes unanswered, malformed, and duplicate question entries", () => {
    const result = calculateMastery([quiz("a", [
      { questionId: "1", topicId: null, answered: true, isCorrect: false },
      { questionId: "1", topicId: null, answered: true, isCorrect: true },
      { questionId: "2", topicId: null, answered: false, isCorrect: null },
    ])]);
    expect(result).toEqual({ percent: 0, correct: 0, answered: 1 });
  });

  it("returns no mastery when there are no reliable answers", () => {
    expect(calculateMastery([quiz("a", [])])).toBeNull();
  });
});
