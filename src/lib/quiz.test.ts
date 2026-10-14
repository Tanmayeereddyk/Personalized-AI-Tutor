import { describe, expect, it } from "vitest";

import { formatClock, isAnswerCorrect } from "./quiz";

describe("formatClock", () => {
  it("formats milliseconds as MM:SS", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(59_000)).toBe("00:59");
    expect(formatClock(60_000)).toBe("01:00");
    expect(formatClock(600_000)).toBe("10:00");
    expect(formatClock(3_600_000)).toBe("60:00");
  });
});

describe("isAnswerCorrect", () => {
  const question = {
    id: "q1",
    type: "true-false" as const,
    prompt: "True or false?",
    correctAnswer: "True",
    explanation: "Because the material says so.",
  };

  it("ignores case and surrounding whitespace", () => {
    expect(isAnswerCorrect(question, " true ")).toBe(true);
  });

  it("rejects wrong, empty and missing answers", () => {
    expect(isAnswerCorrect(question, "False")).toBe(false);
    expect(isAnswerCorrect(question, "   ")).toBe(false);
    expect(isAnswerCorrect(question, undefined)).toBe(false);
  });

  it("accepts any listed spelling for short answers", () => {
    const shortAnswer = {
      id: "q2",
      type: "short-answer" as const,
      prompt: "Name it.",
      correctAnswer: "the output",
      acceptedAnswers: ["output", "the output"],
      explanation: "The measured effect.",
    };
    expect(isAnswerCorrect(shortAnswer, "Output")).toBe(true);
  });
});
