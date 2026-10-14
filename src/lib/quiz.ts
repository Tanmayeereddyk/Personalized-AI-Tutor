/**
 * Shared quiz types and answer helpers.
 *
 * This module holds pure shapes and utilities used by the quiz builder, the
 * quiz runner and the API mapping. The generated quiz itself is no longer built
 * in the browser: it comes from the backend `/quizzes/generate` endpoint, where
 * the configured language model writes the questions from the selected topics'
 * indexed content.
 *
 * A generated quiz only ever contains the *public* questions — the correct
 * answers and explanations are held server-side and revealed by the submit
 * endpoint (see {@link QuizAttemptResult}).
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

/** A real source reference attached to a question. */
export interface QuizSource {
  /** e.g. "Page 12", "Slide 4", "00:12:30". */
  label: string;
  materialName: string;
  /** Not sent before submission (it could hint at the answer); optional. */
  snippet?: string | undefined;
}

export interface QuizQuestion {
  id: string;
  topicId?: string | null | undefined;
  type: QuizQuestionType;
  prompt: string;
  /** Present for multiple-choice and true/false; absent for short answer. */
  options?: string[] | undefined;
  /** Only present in graded results — never in a quiz taken by the student. */
  correctAnswer?: string | undefined;
  /** Extra accepted spellings for short answer (loose matching). */
  acceptedAnswers?: string[] | undefined;
  /** Only present in graded results. */
  explanation?: string | undefined;
  source?: QuizSource | undefined;
}

/** A complete, LLM-generated quiz ready to be taken. */
export interface GeneratedQuiz {
  id: string;
  /** The persisted server-side quiz (with its answer key) used to grade it. */
  setId: string;
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

/** One graded question, revealed only after the attempt is submitted. */
export interface QuizResultItem {
  id: string;
  type: QuizQuestionType;
  prompt: string;
  options?: string[] | undefined;
  given: string;
  correct: boolean;
  correctAnswer: string;
  explanation: string;
  source?: QuizSource | undefined;
}

/** A saved attempt with its answers, the answer key and explanations. */
export interface QuizAttemptResult {
  id: string;
  courseId: string;
  quizSetId?: string | null | undefined;
  title: string;
  scopeLabel?: string | null | undefined;
  difficulty: Difficulty;
  questionTypes: QuizQuestionType[];
  timerMinutes?: number | null | undefined;
  score: number;
  total: number;
  percentage: number;
  /** "ai" for a graded generated quiz, "manual" for a hand-logged score. */
  source: string;
  submittedAt?: string | null | undefined;
  createdAt?: string | null | undefined;
  results: QuizResultItem[];
}

/** The payload sent when a student submits a generated quiz. */
export interface QuizSubmission {
  answers: { questionId: string; answer: string }[];
  timeTakenSeconds: number | null;
  /** Idempotency key: reused on retry so an attempt is never saved twice. */
  clientToken: string;
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
  const correct = question.correctAnswer ?? "";
  if (question.type === "short-answer") {
    const candidates = [correct, ...(question.acceptedAnswers ?? [])].filter(Boolean);
    return candidates.some((c) => normalizeAnswer(c) === normalizeAnswer(answer));
  }
  return correct !== "" && normalizeAnswer(answer) === normalizeAnswer(correct);
}

/** Format a duration in ms as MM:SS for the countdown. */
export function formatClock(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
