/**
 * Shared quiz types and answer helpers.
 *
 * This module holds pure shapes and utilities used by the quiz builder, the
 * quiz runner and the API mapping. The generated quiz itself is no longer built
 * in the browser: it comes from the backend `/quizzes/generate` endpoint, where
 * the configured language model writes the questions from the selected topics'
 * indexed content.
 */

import type { Difficulty } from "./types";

/** The three question formats the UI can render. */
export type QuizQuestionType = "multiple-choice" | "true-false" | "short-answer";

export const QUIZ_QUESTION_TYPES: { value: QuizQuestionType; label: string }[] = [
  { value: "multiple-choice", label: "Multiple Choice" },
  { value: "true-false", label: "True/False" },
  { value: "short-answer", label: "Short Answer" },
];

export const DEFAULT_QUIZ_QUESTION_TYPES: QuizQuestionType[] = [
  "multiple-choice",
  "true-false",
  "short-answer",
];

export const QUIZ_DIFFICULTIES: Difficulty[] = ["Easy", "Medium", "Hard", "Mixed"];

/** Time limits offered when the optional timer is enabled (minutes). */
export const QUIZ_TIMER_OPTIONS = [5, 10, 15, 30, 60] as const;

export const QUIZ_QUESTION_COUNT_OPTIONS = [5, 10, 15, 20] as const;

export function labelForQuestionType(type: QuizQuestionType): string {
  return QUIZ_QUESTION_TYPES.find((t) => t.value === type)?.label ?? type;
}

/** A real source reference attached to a generated question. */
export interface QuizSource {
  /** e.g. "Page 12", "Slide 4", "00:12:30". */
  label: string;
  materialName: string;
  snippet: string;
}

export interface QuizQuestion {
  id: string;
  type: QuizQuestionType;
  prompt: string;
  /** Present for multiple-choice and true/false; absent for short answer. */
  options?: string[] | undefined;
  correctAnswer: string;
  /** Extra accepted spellings for short answer (loose matching). */
  acceptedAnswers?: string[] | undefined;
  explanation: string;
  source?: QuizSource | undefined;
}

/** A complete, LLM-generated quiz ready to be taken. */
export interface GeneratedQuiz {
  id: string;
  courseId: string;
  title: string;
  /** A short label for what the quiz covers (the selected topic names). */
  scopeLabel: string;
  topicIds: string[];
  topicNames: string[];
  difficulty: Difficulty;
  questionTypes: QuizQuestionType[];
  /** null = no time limit. */
  timerMinutes: number | null;
  generatedAt: string;
  questions: QuizQuestion[];
}

/** The settings chosen on the Quiz Configuration screen. */
export interface QuizConfig {
  questionCount: number;
  difficulty: Difficulty;
  questionTypes: QuizQuestionType[];
  /** null = timer disabled (the default). */
  timerMinutes: number | null;
}

export const DEFAULT_QUIZ_CONFIG: QuizConfig = {
  questionCount: 5,
  difficulty: "Medium",
  questionTypes: DEFAULT_QUIZ_QUESTION_TYPES,
  timerMinutes: null,
};

const normalizeAnswer = (value: string): string => value.trim().toLowerCase().replace(/\s+/g, " ");

/** Loose answer matching (trim + case + whitespace). */
export function isAnswerCorrect(question: QuizQuestion, answer: string | undefined): boolean {
  if (answer === undefined || answer.trim() === "") return false;
  if (question.type === "short-answer") {
    const candidates =
      question.acceptedAnswers && question.acceptedAnswers.length
        ? question.acceptedAnswers
        : [question.correctAnswer];
    return candidates.some((c) => normalizeAnswer(c) === normalizeAnswer(answer));
  }
  return normalizeAnswer(answer) === normalizeAnswer(question.correctAnswer);
}

/** Format a duration in ms as MM:SS for the countdown. */
export function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
