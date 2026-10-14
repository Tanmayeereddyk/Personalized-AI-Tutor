import type { Quiz } from "./types";

export interface Mastery {
  percent: number;
  correct: number;
  answered: number;
}

/** Pool reliable answer-level results; old score-only attempts are excluded. */
export function calculateMastery(quizzes: Quiz[], topicId?: string): Mastery | null {
  let correct = 0;
  let answered = 0;
  const seen = new Set<string>();
  for (const quiz of quizzes) {
    for (const answer of quiz.answers ?? []) {
      if (!answer.answered || typeof answer.isCorrect !== "boolean") continue;
      if (topicId && answer.topicId !== topicId) continue;
      const key = `${quiz.id}:${answer.questionId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      answered += 1;
      if (answer.isCorrect) correct += 1;
    }
  }
  return answered ? { percent: Math.round((correct / answered) * 100), correct, answered } : null;
}
