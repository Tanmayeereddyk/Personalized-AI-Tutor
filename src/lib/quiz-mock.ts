/**
 * MOCK quiz data + frontend-only quiz state helpers.
 *
 * ⚠️ Nothing in this file talks to the backend or any AI service. The
 * questions below are hand-written placeholders ("demo questions") used to
 * build and demonstrate the Quiz UI. When a real quiz-generation API exists,
 * replace `buildMockQuiz` with the API call and keep the exported types — the
 * UI (QuizBuilder / QuizRunner) only depends on these shapes.
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

/** A source reference attached to a mock question (page / slide / timestamp). */
export interface MockQuizSource {
  /** e.g. "Page 12", "Slide 4", "00:12:30". */
  label: string;
  materialName: string;
  snippet: string;
}

export interface MockQuizQuestion {
  id: string;
  type: QuizQuestionType;
  prompt: string;
  /** Present for multiple-choice and true/false; absent for short answer. */
  options?: string[] | undefined;
  correctAnswer: string;
  /** Extra accepted spellings for short answer (loose matching). */
  acceptedAnswers?: string[] | undefined;
  explanation: string;
  source?: MockQuizSource | undefined;
}

export interface MockQuiz {
  id: string;
  courseId: string;
  title: string;
  materialId: string;
  materialName: string;
  difficulty: Difficulty;
  questionTypes: QuizQuestionType[];
  /** null = no time limit. */
  timerMinutes: number | null;
  generatedAt: string;
  questions: MockQuizQuestion[];
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

// ---------------------------------------------------------------------------
// Demo question bank (hand-written placeholders — not generated)
// ---------------------------------------------------------------------------

interface MockQuestionSeed {
  prompt: string;
  options?: string[] | undefined;
  correctAnswer: string;
  acceptedAnswers?: string[] | undefined;
  explanation: string;
  sourceLabel: string;
  sourceSnippet: string;
}

const MULTIPLE_CHOICE_SEEDS: MockQuestionSeed[] = [
  {
    prompt:
      "Which description best captures the core idea presented in this material?",
    options: [
      "A repeatable process that turns an input into a measurable result",
      "A fixed list of unrelated facts with no relationship between them",
      "A single event that cannot be repeated or tested",
      "A rule that only applies outside of a classroom setting",
    ],
    correctAnswer:
      "A repeatable process that turns an input into a measurable result",
    explanation:
      "The material frames the topic as a repeatable process with a defined input and a measurable outcome, which is what makes it testable.",
    sourceLabel: "Page 3",
    sourceSnippet: "…the process takes an input and produces a measurable result…",
  },
  {
    prompt: "According to the material, what should you check FIRST?",
    options: [
      "Whether the necessary prerequisite conditions are met",
      "The final grade for the unit",
      "Which textbook edition your classmate bought",
      "How long the lecture recording is",
    ],
    correctAnswer: "Whether the necessary prerequisite conditions are met",
    explanation:
      "Prerequisites are checked before anything else, because the rest of the method assumes they already hold.",
    sourceLabel: "Slide 7",
    sourceSnippet: "Step 1 — confirm every prerequisite is satisfied before continuing.",
  },
  {
    prompt: "Which example does the material use to make the concept concrete?",
    options: [
      "A worked example with a small, easy-to-follow dataset",
      "A historical timeline of the field",
      "A list of unrelated definitions",
      "A set of exam dates",
    ],
    correctAnswer: "A worked example with a small, easy-to-follow dataset",
    explanation:
      "A small worked example is used so each step can be followed without extra theory getting in the way.",
    sourceLabel: "Page 9",
    sourceSnippet: "Consider the following worked example with a small dataset…",
  },
  {
    prompt: "What is a likely consequence of skipping a step in the method?",
    options: [
      "The result becomes unreliable and hard to reproduce",
      "The method becomes faster and always more accurate",
      "Nothing changes, because the order does not matter",
      "The input automatically corrects itself",
    ],
    correctAnswer: "The result becomes unreliable and hard to reproduce",
    explanation:
      "The steps build on one another; skipping one breaks the chain and makes the outcome unreliable and hard to reproduce.",
    sourceLabel: "Page 11",
    sourceSnippet: "…omitting a step makes the result difficult to reproduce…",
  },
  {
    prompt: "Which term does the material define as 'the measured effect'?",
    options: ["The output", "The prerequisite", "The assumption", "The constraint"],
    correctAnswer: "The output",
    explanation:
      "The output is defined as the measured effect of applying the process to an input.",
    sourceLabel: "Slide 12",
    sourceSnippet: "Output — the measured effect produced by the process.",
  },
  {
    prompt: "Why does the material recommend testing with a second example?",
    options: [
      "To confirm the result generalises beyond a single case",
      "To make the material longer",
      "To avoid learning the first example",
      "To replace the need for any explanation",
    ],
    correctAnswer: "To confirm the result generalises beyond a single case",
    explanation:
      "A second example checks that the outcome is not a coincidence of the first case.",
    sourceLabel: "00:12:30",
    sourceSnippet: "…try a second case to see whether it still holds…",
  },
  {
    prompt: "Which assumption does the method rely on?",
    options: [
      "The input is complete and correctly prepared",
      "The input can be missing any number of fields",
      "The result never needs to be explained",
      "The order of the steps is irrelevant",
    ],
    correctAnswer: "The input is complete and correctly prepared",
    explanation:
      "The method assumes the input has already been prepared correctly; incomplete input invalidates the result.",
    sourceLabel: "Page 14",
    sourceSnippet: "Assumption: the input has been validated before the process begins.",
  },
  {
    prompt: "What does the material suggest doing when the result looks wrong?",
    options: [
      "Revisit the earlier steps before changing the final one",
      "Delete the whole piece of work and start over",
      "Ignore it, because it is usually correct",
      "Change the definition of the output",
    ],
    correctAnswer: "Revisit the earlier steps before changing the final one",
    explanation:
      "Errors usually originate earlier in the chain, so the earlier steps are re-checked first.",
    sourceLabel: "Page 16",
    sourceSnippet: "If the result is unexpected, re-check the earlier steps first.",
  },
];

const TRUE_FALSE_SEEDS: MockQuestionSeed[] = [
  {
    prompt: "The concept in this material can be applied to more than one situation.",
    correctAnswer: "True",
    explanation:
      "The material stresses that the idea generalises and is not limited to a single example.",
    sourceLabel: "Page 5",
    sourceSnippet: "…this applies to many situations, not just the one shown…",
  },
  {
    prompt: "The method described requires no prior knowledge to use correctly.",
    correctAnswer: "False",
    explanation:
      "The material lists prerequisites that must be met before the method can be used correctly.",
    sourceLabel: "Slide 7",
    sourceSnippet: "Step 1 — confirm every prerequisite is satisfied…",
  },
  {
    prompt: "Changing the order of the steps does not affect the result.",
    correctAnswer: "False",
    explanation:
      "The steps are ordered deliberately; changing the order affects the outcome.",
    sourceLabel: "Page 11",
    sourceSnippet: "…each step depends on the previous one…",
  },
  {
    prompt: "The material recommends explaining the result in your own words.",
    correctAnswer: "True",
    explanation:
      "Restating the result in your own words is recommended as a check on understanding.",
    sourceLabel: "00:18:05",
    sourceSnippet: "…try to explain the result in your own words…",
  },
  {
    prompt: "The output is measured, while the input is not.",
    correctAnswer: "False",
    explanation:
      "Both are important: the input is prepared and validated, and the output is measured.",
    sourceLabel: "Page 14",
    sourceSnippet: "Assumption: the input has been validated before the process begins.",
  },
  {
    prompt: "A single successful example is enough to be confident the method works.",
    correctAnswer: "False",
    explanation:
      "The material recommends a second example to rule out a coincidence.",
    sourceLabel: "00:12:30",
    sourceSnippet: "…try a second case to see whether it still holds…",
  },
];

const SHORT_ANSWER_SEEDS: MockQuestionSeed[] = [
  {
    prompt: "In one short sentence, define the central concept of this material.",
    correctAnswer: "a repeatable process with a measurable output",
    acceptedAnswers: [
      "a repeatable process with a measurable output",
      "repeatable process with a measurable result",
      "a process that turns input into a measurable result",
    ],
    explanation:
      "The material defines the concept as a repeatable process that turns an input into a measurable result.",
    sourceLabel: "Page 3",
    sourceSnippet: "…the process takes an input and produces a measurable result…",
  },
  {
    prompt: "Name the first thing you should confirm before starting.",
    correctAnswer: "the prerequisites",
    acceptedAnswers: ["prerequisites", "the prerequisites", "prerequisite conditions"],
    explanation:
      "Prerequisites are confirmed first; everything else assumes they hold.",
    sourceLabel: "Slide 7",
    sourceSnippet: "Step 1 — confirm every prerequisite is satisfied before continuing.",
  },
  {
    prompt: "What is the measured effect of the process called?",
    correctAnswer: "the output",
    acceptedAnswers: ["output", "the output"],
    explanation: "The measured effect is called the output.",
    sourceLabel: "Slide 12",
    sourceSnippet: "Output — the measured effect produced by the process.",
  },
  {
    prompt: "Why is a second example recommended? (one short phrase)",
    correctAnswer: "to check the result generalises",
    acceptedAnswers: [
      "to check the result generalises",
      "to see if it still holds",
      "to rule out a coincidence",
      "to confirm it generalises",
    ],
    explanation:
      "A second example confirms the outcome is not a coincidence of the first case.",
    sourceLabel: "00:12:30",
    sourceSnippet: "…try a second case to see whether it still holds…",
  },
  {
    prompt: "What should you re-check when the result looks unexpected?",
    correctAnswer: "the earlier steps",
    acceptedAnswers: ["the earlier steps", "earlier steps", "previous steps"],
    explanation:
      "Errors usually start earlier in the chain, so the earlier steps are re-checked first.",
    sourceLabel: "Page 16",
    sourceSnippet: "If the result is unexpected, re-check the earlier steps first.",
  },
  {
    prompt: "Roughly how should you restate a result to test your understanding?",
    correctAnswer: "in your own words",
    acceptedAnswers: ["in your own words", "your own words", "own words"],
    explanation:
      "Restating the result in your own words is a quick check that you understood it.",
    sourceLabel: "00:18:05",
    sourceSnippet: "…try to explain the result in your own words…",
  },
];

const SEEDS: Record<QuizQuestionType, MockQuestionSeed[]> = {
  "multiple-choice": MULTIPLE_CHOICE_SEEDS,
  "true-false": TRUE_FALSE_SEEDS,
  "short-answer": SHORT_ANSWER_SEEDS,
};

function cyclePick<T>(list: T[], index: number): T {
  const item = list[index % list.length];
  if (item === undefined) throw new Error("cyclePick: empty list");
  return item;
}

/**
 * Build a mock quiz for a material. Deterministic: the same config always
 * yields the same questions, which keeps the UI easy to test.
 */
export function buildMockQuiz(input: {
  courseId: string;
  materialId: string;
  materialName: string;
  config: QuizConfig;
}): MockQuiz {
  const { courseId, materialId, materialName, config } = input;
  const types = config.questionTypes.length
    ? config.questionTypes
    : DEFAULT_QUIZ_QUESTION_TYPES;
  const total = Math.max(1, Math.min(30, Math.round(config.questionCount)));

  // One cursor per selected type, consumed round-robin so every chosen type
  // shows up as early as possible (a 3-question quiz with 3 types gets one of
  // each) while still cycling if there are more questions than seeds.
  const pools = types.map((type) => ({ type, seeds: SEEDS[type], next: 0 }));

  const questions: MockQuizQuestion[] = Array.from({ length: total }, (_, i) => {
    const pool = cyclePick(pools, i);
    const seed = cyclePick(pool.seeds, pool.next);
    pool.next += 1;
    return {
      id: `${materialId}-q${i + 1}`,
      type: pool.type,
      prompt: seed.prompt,
      options: seed.options,
      correctAnswer: seed.correctAnswer,
      acceptedAnswers: seed.acceptedAnswers,
      explanation: seed.explanation,
      source: {
        label: seed.sourceLabel,
        materialName,
        snippet: seed.sourceSnippet,
      },
    };
  });

  return {
    id: `mock-${materialId}-${Date.now()}`,
    courseId,
    title: `${materialName} — Practice Quiz`,
    materialId,
    materialName,
    difficulty: config.difficulty,
    questionTypes: types,
    timerMinutes: config.timerMinutes,
    generatedAt: new Date().toISOString(),
    questions,
  };
}

const normalizeAnswer = (value: string): string =>
  value.trim().toLowerCase().replace(/\s+/g, " ");

/** Loose answer matching (trim + case + whitespace) for the demo results. */
export function isAnswerCorrect(
  question: MockQuizQuestion,
  answer: string | undefined,
): boolean {
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
