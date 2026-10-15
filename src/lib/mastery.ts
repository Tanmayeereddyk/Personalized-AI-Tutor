import type { Quiz } from "./types";

export interface Mastery {
  percent: number;
  correct: number;
  answered: number;
}

/**
 * Pool only reliable answer-level data for one course. AI attempts use their
 * graded `results`; manual/legacy attempts qualify only when they contain the
 * validated per-question answer records. Summary score/total alone is excluded
 * because it cannot distinguish answered from unanswered questions.
 */
export function calculateMastery(quizzes: Quiz[], courseId: string): Mastery | null {
  let correct = 0;
  let answered = 0;

  for (const quiz of quizzes) {
    if (quiz.courseId !== courseId || typeof quiz.id !== "string" || !quiz.id) continue;
    const seenQuestionIds = new Set<string>();

    // A populated graded-results array is reliable even on older rows whose
    // source marker was left null. Empty default arrays do not qualify.
    if (quiz.source === "ai" || (Array.isArray(quiz.results) && quiz.results.length > 0)) {
      for (const result of Array.isArray(quiz.results) ? quiz.results : []) {
        if (
          !result ||
          typeof result.id !== "string" ||
          !result.id.trim() ||
          typeof result.given !== "string" ||
          !result.given.trim() ||
          typeof result.correct !== "boolean"
        )
          continue;
        const questionId = result.id.trim();
        if (seenQuestionIds.has(questionId)) continue;
        seenQuestionIds.add(questionId);
        answered += 1;
        if (result.correct) correct += 1;
      }
      continue;
    }

    // Manual or legacy attempts count only if the saved data explicitly
    // identifies answered questions and their correctness.
    for (const answer of Array.isArray(quiz.answers) ? quiz.answers : []) {
      if (
        !answer ||
        typeof answer.questionId !== "string" ||
        !answer.questionId.trim() ||
        answer.answered !== true ||
        typeof answer.isCorrect !== "boolean"
      )
        continue;
      const questionId = answer.questionId.trim();
      if (seenQuestionIds.has(questionId)) continue;
      seenQuestionIds.add(questionId);
      answered += 1;
      if (answer.isCorrect) correct += 1;
    }
  }

  if (!answered) return null;
  const percent = Math.min(100, Math.max(0, Math.round((correct / answered) * 100)));
  return { percent, correct, answered };
}
