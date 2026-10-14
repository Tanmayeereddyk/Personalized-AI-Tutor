import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Clock,
  ListChecks,
  Loader2,
  RefreshCw,
  Sparkles,
} from "lucide-react";

import { EmptyState, Modal } from "@/components/ui/kit";
import { CheckGrid, Field, PillGroup, toggle } from "@/components/practice/Builder";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { useGenerateQuiz, useTopics } from "@/lib/queries";
import { cn } from "@/lib/utils";
import {
  DEFAULT_QUIZ_CONFIG,
  QUIZ_DIFFICULTIES,
  QUIZ_QUESTION_COUNT_OPTIONS,
  QUIZ_QUESTION_TYPES,
  QUIZ_TIMER_OPTIONS,
  type GeneratedQuiz,
  type QuizConfig,
  type QuizQuestionType,
} from "@/lib/quiz";

const COUNT_OPTIONS: number[] = [...QUIZ_QUESTION_COUNT_OPTIONS];
const TIMER_OPTIONS: number[] = [...QUIZ_TIMER_OPTIONS];

export interface QuizStartInput {
  topicIds: string[];
  config: QuizConfig;
}

interface QuizBuilderProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courseId: string;
  /** Called with the LLM-generated quiz once the backend returns it. */
  onGenerated: (quiz: GeneratedQuiz) => void;
}

/**
 * Two-step quiz setup: pick the course topics, then choose the quiz settings.
 *
 * Topics are the only selectable unit — the backend resolves each topic's
 * source materials internally. Clicking Generate calls the AI generation
 * endpoint; the quiz is never built from a local question bank, and a failed
 * request shows an error the student can retry.
 */
export function QuizBuilder({ open, onOpenChange, courseId, onGenerated }: QuizBuilderProps) {
  const topics = useTopics(courseId);
  const list = useMemo(() => topics.data ?? [], [topics.data]);
  const generateQuiz = useGenerateQuiz(courseId);

  const [step, setStep] = useState<"topics" | "config">("topics");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const [questionCount, setQuestionCount] = useState(DEFAULT_QUIZ_CONFIG.questionCount);
  const [difficulty, setDifficulty] = useState(DEFAULT_QUIZ_CONFIG.difficulty);
  const [types, setTypes] = useState<QuizQuestionType[]>(DEFAULT_QUIZ_CONFIG.questionTypes);
  const [timerEnabled, setTimerEnabled] = useState(false);
  const [timerMinutes, setTimerMinutes] = useState<number>(10);

  const selectedTopics = useMemo(
    () => list.filter((topic) => selectedIds.includes(topic.id)),
    [list, selectedIds],
  );

  const resetForm = () => {
    setStep("topics");
    setSelectedIds([]);
    setQuestionCount(DEFAULT_QUIZ_CONFIG.questionCount);
    setDifficulty(DEFAULT_QUIZ_CONFIG.difficulty);
    setTypes(DEFAULT_QUIZ_CONFIG.questionTypes);
    setTimerEnabled(false);
    setTimerMinutes(10);
    generateQuiz.reset();
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) resetForm();
    onOpenChange(next);
  };

  const toggleTopic = (topicId: string) => {
    setSelectedIds((prev) => toggle(prev, topicId));
  };

  const toggleType = (next: string[]) => {
    setTypes(QUIZ_QUESTION_TYPES.filter((t) => next.includes(t.label)).map((t) => t.value));
  };

  const config = (): QuizConfig => ({
    questionCount,
    difficulty,
    questionTypes: types,
    timerMinutes: timerEnabled ? timerMinutes : null,
  });

  const canGenerate = selectedIds.length > 0 && types.length > 0;

  const generate = () => {
    if (!canGenerate || generateQuiz.isPending) return;
    generateQuiz.mutate(
      { topicIds: selectedIds, config: config() },
      {
        onSuccess: (quiz) => {
          onGenerated(quiz);
          handleOpenChange(false);
        },
      },
    );
  };

  const errorMessage =
    generateQuiz.error instanceof Error
      ? generateQuiz.error.message
      : generateQuiz.isError
        ? "Could not generate the quiz. Please try again."
        : null;

  const readyTopics = topics.isLoading || topics.isError ? false : list.length > 0;

  return (
    <Modal
      open={open}
      onOpenChange={handleOpenChange}
      size="xl"
      title={step === "topics" ? "Choose topics" : "Configure your quiz"}
      description={
        step === "topics"
          ? "Select the topics your quiz should cover."
          : selectedTopics.length
            ? `Questions from ${selectedTopics.map((topic) => topic.name).join(", ")}.`
            : "Choose how you want the quiz to look."
      }
    >
      {step === "topics" ? (
        <div>
          <div className="mt-1">
            {topics.isLoading ? (
              <div className="card flex items-center justify-center gap-2 border-dashed px-6 py-14 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading your topics…
              </div>
            ) : topics.isError ? (
              <div className="card px-6 py-12 text-center">
                <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <p className="font-medium">Couldn’t load your topics</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {(topics.error as Error)?.message ?? "Please try again."}
                </p>
                <button className="btn btn-ghost mt-5" onClick={() => void topics.refetch()}>
                  <RefreshCw className="h-4 w-4" />
                  Try again
                </button>
              </div>
            ) : !readyTopics ? (
              <EmptyState
                icon={ListChecks}
                title="No topics yet"
                body="Generate the knowledge map for this course from your materials, then come back to build a quiz."
              />
            ) : (
              <>
                {/* A narrow, vertical checklist: one topic under the next. */}
                <div className="mx-auto max-w-xl">
                  <ul
                    role="list"
                    aria-label="Course topics"
                    className="max-h-72 divide-y overflow-y-auto rounded-xl border bg-background"
                  >
                    {list.map((topic) => {
                      const checked = selectedIds.includes(topic.id);
                      return (
                        <li key={topic.id}>
                          <label
                            htmlFor={`quiz-topic-${topic.id}`}
                            className={cn(
                              "flex cursor-pointer items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-accent/40",
                              checked && "bg-accent/30",
                            )}
                          >
                            <Checkbox
                              id={`quiz-topic-${topic.id}`}
                              checked={checked}
                              onCheckedChange={() => toggleTopic(topic.id)}
                              className="mt-0.5"
                            />
                            <span className="min-w-0 flex-1">
                              <span className="block break-words text-sm leading-snug font-medium">
                                {topic.name}
                              </span>
                              {topic.description ? (
                                <span className="mt-0.5 block text-xs text-muted-foreground">
                                  {topic.description}
                                </span>
                              ) : null}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                    <span>
                      {selectedIds.length} of {list.length} selected
                    </span>
                    {list.length > 1 ? (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          className="hover:text-foreground"
                          onClick={() => setSelectedIds(list.map((topic) => topic.id))}
                        >
                          Select all
                        </button>
                        <span aria-hidden="true">·</span>
                        <button
                          type="button"
                          className="hover:text-foreground"
                          onClick={() => setSelectedIds([])}
                        >
                          Clear
                        </button>
                      </div>
                    ) : null}
                  </div>
                </div>
              </>
            )}
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <p className="min-w-0 text-sm text-muted-foreground">
              {selectedTopics.length > 0
                ? `${selectedTopics.length} topic${selectedTopics.length === 1 ? "" : "s"} selected`
                : "Select at least one topic to continue."}
            </p>
            <div className="flex items-center gap-2">
              <button className="btn btn-ghost" onClick={() => handleOpenChange(false)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={() => setStep("config")}
                disabled={selectedIds.length === 0}
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="rounded-2xl border bg-background p-3">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-muted-foreground">
                <ListChecks className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">
                  {selectedTopics.length} topic{selectedTopics.length === 1 ? "" : "s"}
                </div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  {selectedTopics.slice(0, 4).map((topic) => (
                    <span key={topic.id} className="chip">
                      {topic.name}
                    </span>
                  ))}
                  {selectedTopics.length > 4 ? (
                    <span className="chip">+{selectedTopics.length - 4} more</span>
                  ) : null}
                </div>
              </div>
              <button className="btn btn-ghost" onClick={() => setStep("topics")}>
                <ArrowLeft className="h-4 w-4" />
                Change
              </button>
            </div>
          </div>

          <Field label="Number of questions">
            <PillGroup<number>
              options={COUNT_OPTIONS}
              value={questionCount}
              onChange={setQuestionCount}
              format={(v) => `${v}`}
            />
          </Field>

          <Field label="Difficulty">
            <PillGroup options={QUIZ_DIFFICULTIES} value={difficulty} onChange={setDifficulty} />
          </Field>

          <Field label="Question types">
            <CheckGrid
              options={QUIZ_QUESTION_TYPES.map((t) => t.label)}
              value={QUIZ_QUESTION_TYPES.filter((t) => types.includes(t.value)).map((t) => t.label)}
              onChange={toggleType}
            />
            {types.length === 0 ? (
              <p className="mt-2 text-xs text-destructive">Choose at least one question type.</p>
            ) : null}
          </Field>

          {/* Optional timer */}
          <div className="rounded-2xl border bg-background p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <label
                  htmlFor="quiz-timer-enabled"
                  className="flex items-center gap-2 text-sm font-medium"
                >
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  Enable timer
                </label>
                <p className="mt-1 text-xs text-muted-foreground">
                  Off by default — take the quiz with no time limit.
                </p>
              </div>
              <Switch
                id="quiz-timer-enabled"
                checked={timerEnabled}
                onCheckedChange={setTimerEnabled}
                aria-label="Enable quiz timer"
              />
            </div>

            {timerEnabled ? (
              <div className="mt-4 border-t pt-4">
                <Field label="Time limit">
                  <PillGroup<number>
                    options={TIMER_OPTIONS}
                    value={timerMinutes}
                    onChange={setTimerMinutes}
                    format={(v) => `${v} min`}
                  />
                </Field>
                <p className="mt-2 text-xs text-muted-foreground" role="status">
                  Time limit:{" "}
                  <span className="font-medium text-foreground">{timerMinutes} minutes</span> (
                  {timerMinutes}:00). The countdown starts when the quiz opens.
                </p>
              </div>
            ) : null}
          </div>

          {errorMessage ? (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm text-destructive"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div className="min-w-0 flex-1">
                <span>{errorMessage}</span>
                {/* Retry re-generates with the topics and settings still selected. */}
                <button
                  type="button"
                  className="mt-1 inline-flex items-center gap-1 font-medium underline-offset-2 hover:underline disabled:opacity-60"
                  onClick={generate}
                  disabled={generateQuiz.isPending}
                >
                  {generateQuiz.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  {generateQuiz.isPending ? "Retrying…" : "Retry"}
                </button>
              </div>
            </div>
          ) : null}

          {/* Summary + generate */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
              {generateQuiz.isPending
                ? "Generating questions with AI…"
                : `${questionCount} questions · ${difficulty} · ` +
                  `${types.length === 1 ? "1 type" : `${types.length} types`} · ` +
                  `${timerEnabled ? `${timerMinutes}-minute timer` : "no timer"}`}
            </p>
            <div className="flex items-center gap-2">
              <button
                className="btn btn-ghost"
                onClick={() => setStep("topics")}
                disabled={generateQuiz.isPending}
              >
                Back
              </button>
              <button
                className={cn("btn btn-primary")}
                onClick={generate}
                disabled={!canGenerate || generateQuiz.isPending}
              >
                {generateQuiz.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                {generateQuiz.isPending
                  ? "Generating…"
                  : errorMessage
                    ? "Try again"
                    : "Generate Quiz"}
              </button>
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
