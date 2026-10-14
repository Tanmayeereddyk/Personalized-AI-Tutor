import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  FileText,
  LayoutGrid,
  RotateCw,
  Sparkles,
  Timer,
  X,
  XCircle,
} from "lucide-react";

import { Modal, ProgressBar, Ring } from "@/components/ui/kit";
import { MathText } from "@/components/math/MathText";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { cn } from "@/lib/utils";
import { useCountdown } from "@/lib/use-countdown";
import {
  formatClock,
  isAnswerCorrect,
  labelForQuestionType,
  type GeneratedQuiz,
  type QuizQuestion,
} from "@/lib/quiz";
import { scoreTone } from "@/components/practice/Builder";

type Phase = "taking" | "results";
type SubmitReason = "manual" | "timeout";

interface QuizRunnerProps {
  quiz: GeneratedQuiz;
  onComplete: (attempt: {
    name: string;
    topic: string;
    difficulty: string;
    score: number;
    total: number;
    answers: { question_id: string; topic_id: string | null; answered: boolean; is_correct: boolean | null }[];
  }) => Promise<unknown>;
  /** Leave the quiz entirely (back to the quiz list). */
  onExit: () => void;
}

/** Thresholds for the countdown warnings (1 minute, then 10 seconds). */
const WARN_AFTER_MS = 60_000;
const CRITICAL_AFTER_MS = 10_000;

/**
 * Full-screen quiz-taking experience: question navigation, a question
 * navigator, an optional countdown and a results review. All answers live in
 * local state — nothing is sent to the backend.
 */
export function QuizRunner({ quiz, onExit, onComplete }: QuizRunnerProps) {
  const total = quiz.questions.length;

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>("taking");
  const [reason, setReason] = useState<SubmitReason | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [confirmSubmit, setConfirmSubmit] = useState(false);
  const [confirmExit, setConfirmExit] = useState(false);
  const [announcement, setAnnouncement] = useState("");

  // The deadline is captured once (in the initializer) and only re-created by
  // an explicit retake, so re-renders and question navigation can't restart it.
  const [deadline, setDeadline] = useState<number | null>(() =>
    quiz.timerMinutes != null ? Date.now() + quiz.timerMinutes * 60_000 : null,
  );

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const savedAttempt = useRef(false);
  const resetScroll = useCallback(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = 0;
  }, []);

  const finish = useCallback(
    (submitReason: SubmitReason) => {
      setReason(submitReason);
      setDeadline(null); // stops the countdown immediately
      setPhase("results");
      setConfirmSubmit(false);
      setConfirmExit(false);
      setNavOpen(false);
      resetScroll();
    },
    [resetScroll],
  );

  const handleExpire = useCallback(() => finish("timeout"), [finish]);
  const remainingMs = useCountdown(deadline, handleExpire);

  const timerConfigured = quiz.timerMinutes != null;
  const timerActive = timerConfigured && phase === "taking";
  const isWarning = timerActive && remainingMs <= WARN_AFTER_MS;
  const isCritical = timerActive && remainingMs <= CRITICAL_AFTER_MS;

  // Announce the thresholds once instead of every tick (screen-reader friendly).
  useEffect(() => {
    if (!timerActive) {
      setAnnouncement("");
      return;
    }
    if (remainingMs <= CRITICAL_AFTER_MS) setAnnouncement("10 seconds remaining");
    else if (remainingMs <= WARN_AFTER_MS) setAnnouncement("1 minute remaining");
  }, [timerActive, remainingMs]);

  const results = useMemo(
    () =>
      quiz.questions.map((question) => {
        const given = answers[question.id] ?? "";
        return { question, given, correct: isAnswerCorrect(question, given) };
      }),
    [quiz.questions, answers],
  );

  const answeredCount = results.filter((r) => r.given.trim() !== "").length;
  const unanswered = total - answeredCount;
  const score = results.filter((r) => r.correct).length;
  const pct = total > 0 ? Math.round((score / total) * 100) : 0;

  useEffect(() => {
    if (phase !== "results" || savedAttempt.current) return;
    savedAttempt.current = true;
    const answerDetails = results.map(({ question, given, correct }) => {
      const answered = given.trim() !== "";
      return {
        question_id: question.id,
        topic_id: question.topicId ?? null,
        answered,
        is_correct: answered ? correct : null,
      };
    });
    void onComplete({
      name: quiz.title,
      topic: quiz.scopeLabel,
      difficulty: quiz.difficulty,
      score,
      total,
      answers: answerDetails,
    });
  }, [phase, results, onComplete, quiz.title, quiz.scopeLabel, quiz.difficulty, score, total]);

  const setAnswer = useCallback((id: string, value: string) => {
    setAnswers((prev) => ({ ...prev, [id]: value }));
  }, []);

  const goTo = useCallback(
    (next: number) => {
      setIndex(Math.max(0, Math.min(total - 1, next)));
      resetScroll();
    },
    [total, resetScroll],
  );

  const restart = useCallback(() => {
    savedAttempt.current = false;
    setAnswers({});
    setIndex(0);
    setReason(null);
    setPhase("taking");
    setConfirmSubmit(false);
    setConfirmExit(false);
    setNavOpen(false);
    setDeadline(quiz.timerMinutes != null ? Date.now() + quiz.timerMinutes * 60_000 : null);
    resetScroll();
  }, [quiz.timerMinutes, resetScroll]);

  // Warn before closing/refreshing the tab while the quiz is unfinished.
  useEffect(() => {
    if (phase !== "taking") return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [phase]);

  // Escape asks to leave (unless a dialog is already open and handling it).
  useEffect(() => {
    if (phase !== "taking") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || confirmSubmit || confirmExit) return;
      event.preventDefault();
      setConfirmExit(true);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [phase, confirmSubmit, confirmExit]);

  const question = quiz.questions[index];
  const title = phase === "results" ? "Quiz results" : quiz.title;

  return (
    <div
      className="fixed inset-0 z-40 flex flex-col bg-background"
      role="dialog"
      aria-modal="true"
      aria-labelledby="quiz-session-title"
    >
      {/* Header */}
      <header className="sticky top-0 z-10 flex flex-wrap items-center gap-x-3 gap-y-2 border-b bg-background/85 px-4 py-3 backdrop-blur sm:px-6">
        <button
          type="button"
          className="btn btn-ghost h-9 w-9 p-0"
          aria-label={phase === "taking" ? "Exit quiz" : "Back to quizzes"}
          onClick={() => (phase === "taking" ? setConfirmExit(true) : onExit())}
        >
          <X className="h-4 w-4" />
        </button>

        <div className="min-w-0 flex-1">
          <h1
            id="quiz-session-title"
            className="flex items-center gap-2 truncate text-sm font-semibold sm:text-base"
          >
            <span className="truncate">{title}</span>
          </h1>
          <p className="truncate text-xs text-muted-foreground">
            {quiz.scopeLabel} · {total} questions
          </p>
        </div>

        {timerActive ? (
          <div
            role="timer"
            aria-label={`Time remaining ${formatClock(remainingMs)}`}
            className={cn(
              "flex items-center gap-2 rounded-xl border px-3 py-1.5 font-mono text-sm tabular-nums transition-colors",
              isCritical
                ? "animate-pulse border-destructive/60 bg-destructive/10 text-destructive"
                : isWarning
                  ? "border-warning/60 bg-warning/10 text-warning"
                  : "bg-background text-foreground",
            )}
          >
            {isCritical ? <AlertTriangle className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
            {formatClock(remainingMs)}
          </div>
        ) : null}

        {phase === "taking" ? (
          <button type="button" className="btn btn-primary" onClick={() => setConfirmSubmit(true)}>
            <CheckCircle2 className="h-4 w-4" />
            <span className="hidden sm:inline">Submit Quiz</span>
            <span className="sm:hidden">Submit</span>
          </button>
        ) : null}
      </header>

      {/* Screen-reader-only timer announcements (1 min / 10 s thresholds). */}
      <p className="sr-only" aria-live="assertive">
        {announcement}
      </p>

      {phase === "taking" && question ? (
        <>
          <div ref={scrollRef} className="flex-1 overflow-y-auto">
            <div className="mx-auto flex w-full max-w-5xl gap-6 px-4 py-6 sm:px-6">
              <main className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-muted-foreground">
                    Question <span className="font-medium text-foreground">{index + 1}</span> of{" "}
                    {total}
                  </p>
                  <button
                    type="button"
                    className="btn btn-ghost lg:hidden"
                    aria-expanded={navOpen}
                    onClick={() => setNavOpen((v) => !v)}
                  >
                    <LayoutGrid className="h-4 w-4" />
                    Navigate
                  </button>
                </div>

                <ProgressBar className="mt-3" value={((index + 1) / total) * 100} />

                {navOpen ? (
                  <div className="card mt-4 p-3 lg:hidden">
                    <QuestionNav
                      questions={quiz.questions}
                      answers={answers}
                      index={index}
                      onPick={(i) => {
                        goTo(i);
                        setNavOpen(false);
                      }}
                    />
                  </div>
                ) : null}

                <article className="card mt-6 p-5 sm:p-6">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="chip">{labelForQuestionType(question.type)}</span>
                    <span className="chip">{quiz.difficulty}</span>
                  </div>

                  <h2 className="mt-4 text-lg font-medium leading-snug sm:text-xl">
                    <MathText text={question.prompt} />
                  </h2>

                  <div className="mt-5">
                    <AnswerControl
                      question={question}
                      index={index}
                      value={answers[question.id] ?? ""}
                      onChange={(v) => setAnswer(question.id, v)}
                    />
                  </div>
                </article>
              </main>

              <aside className="hidden w-56 shrink-0 lg:block">
                <div className="card sticky top-24 p-4">
                  <p className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    <LayoutGrid className="h-3.5 w-3.5" />
                    Questions
                  </p>
                  <QuestionNav
                    questions={quiz.questions}
                    answers={answers}
                    index={index}
                    onPick={goTo}
                  />
                  <p className="mt-4 text-xs text-muted-foreground">
                    {answeredCount} of {total} answered
                  </p>
                </div>
              </aside>
            </div>
          </div>

          <footer className="border-t bg-background/85 backdrop-blur">
            <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => goTo(index - 1)}
                disabled={index === 0}
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => goTo(index + 1)}
                  disabled={index >= total - 1}
                >
                  Next
                  <ChevronRight className="h-4 w-4" />
                </button>
                {index >= total - 1 ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => setConfirmSubmit(true)}
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Submit Quiz
                  </button>
                ) : null}
              </div>
            </div>
          </footer>
        </>
      ) : (
        <div ref={scrollRef} className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
            <section className="card p-6 text-center">
              <div className="relative mx-auto h-[140px] w-[140px]">
                <Ring value={pct} />
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <span className={cn("text-3xl font-semibold", scoreTone(pct))}>{pct}%</span>
                  <span className="text-xs text-muted-foreground">
                    {score}/{total} correct
                  </span>
                </div>
              </div>

              {reason === "timeout" ? (
                <p className="mt-4 flex items-center justify-center gap-2 text-sm text-warning">
                  <Timer className="h-4 w-4" />
                  Time&apos;s up — your quiz was submitted automatically.
                </p>
              ) : (
                <p className="mt-4 text-sm text-muted-foreground">
                  You scored {score} out of {total}.
                </p>
              )}

              <div className="mt-4 flex flex-wrap justify-center gap-1.5">
                <span className="chip">{quiz.difficulty}</span>
                {quiz.questionTypes.map((type) => (
                  <span key={type} className="chip">
                    {labelForQuestionType(type)}
                  </span>
                ))}
                <span className="chip">
                  {quiz.timerMinutes != null ? `${quiz.timerMinutes}-minute timer` : "No timer"}
                </span>
              </div>

              <p className="mt-5 flex items-start justify-center gap-2 rounded-xl border border-dashed bg-secondary/40 px-3 py-2 text-left text-xs text-muted-foreground">
                <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                These questions were generated from the topics you selected, grounded in your
                uploaded materials.
              </p>

              <div className="mt-5 flex flex-wrap justify-center gap-2">
                <button type="button" className="btn btn-primary" onClick={restart}>
                  <RotateCw className="h-4 w-4" />
                  Retake
                </button>
                <button type="button" className="btn btn-ghost" onClick={onExit}>
                  Back to quizzes
                </button>
              </div>
            </section>

            <h3 className="mb-3 mt-8 text-sm font-medium uppercase tracking-wider text-muted-foreground">
              Review
            </h3>
            <ul className="space-y-3">
              {results.map(({ question: q, given, correct }, i) => (
                <li
                  key={q.id}
                  className={cn(
                    "card border-l-4 p-4",
                    correct ? "border-l-success" : "border-l-destructive",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <span
                      className={cn(
                        "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium",
                        correct
                          ? "bg-success/15 text-success"
                          : "bg-destructive/15 text-destructive",
                      )}
                    >
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">
                        <MathText text={q.prompt} />
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        <span className="chip">{labelForQuestionType(q.type)}</span>
                      </div>

                      <dl className="mt-3 space-y-1.5 text-sm">
                        <div className="flex gap-2">
                          <dt className="w-28 shrink-0 text-muted-foreground">Your answer</dt>
                          <dd
                            className={cn(
                              "min-w-0 break-words",
                              correct ? "text-success" : "text-destructive",
                            )}
                          >
                            {given.trim() ? (
                              <MathText text={given} />
                            ) : (
                              <span className="italic text-muted-foreground">Not answered</span>
                            )}
                          </dd>
                        </div>
                        {!correct ? (
                          <div className="flex gap-2">
                            <dt className="w-28 shrink-0 text-muted-foreground">Correct answer</dt>
                            <dd className="min-w-0 break-words">
                              <MathText text={q.correctAnswer} />
                            </dd>
                          </div>
                        ) : null}
                      </dl>

                      <p className="mt-3 rounded-lg bg-secondary/50 px-3 py-2 text-sm text-muted-foreground">
                        <MathText text={q.explanation} />
                      </p>

                      {q.source ? (
                        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                          <FileText className="h-3.5 w-3.5" />
                          Source: <span className="text-foreground">
                            {q.source.materialName}
                          </span> · {q.source.label}
                        </p>
                      ) : null}
                    </div>
                    {correct ? (
                      <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />
                    ) : (
                      <XCircle className="h-5 w-5 shrink-0 text-destructive" />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* Submit confirmation */}
      <Modal
        open={confirmSubmit}
        onOpenChange={setConfirmSubmit}
        size="sm"
        title="Submit this quiz?"
        description="You won't be able to change your answers after submitting."
      >
        <p className="text-sm text-muted-foreground">
          {unanswered > 0
            ? `${unanswered} question${unanswered === 1 ? "" : "s"} still unanswered.`
            : "All questions answered."}
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={() => setConfirmSubmit(false)}>
            Keep working
          </button>
          <button type="button" className="btn btn-primary" onClick={() => finish("manual")}>
            Submit Quiz
          </button>
        </div>
      </Modal>

      {/* Exit confirmation */}
      <Modal
        open={confirmExit}
        onOpenChange={setConfirmExit}
        size="sm"
        title="Leave this quiz?"
        description={
          timerActive
            ? "Your timer is still running and your answers will be lost."
            : "Your answers will be lost."
        }
      >
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={() => setConfirmExit(false)}>
            Keep going
          </button>
          <button type="button" className="btn btn-ghost text-destructive" onClick={onExit}>
            Leave quiz
          </button>
        </div>
      </Modal>
    </div>
  );
}

function AnswerControl({
  question,
  index,
  value,
  onChange,
}: {
  question: QuizQuestion;
  index: number;
  value: string;
  onChange: (value: string) => void;
}) {
  if (question.type === "short-answer") {
    const id = `answer-${question.id}`;
    return (
      <div>
        <label htmlFor={id} className="mb-2 block text-sm font-medium">
          Your answer
        </label>
        <textarea
          id={id}
          className="field min-h-[6.5rem] resize-y"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Type a short answer…"
        />
        <p className="mt-2 text-xs text-muted-foreground">
          Marking is loose: capitalisation and extra spaces are ignored.
        </p>
      </div>
    );
  }

  const options = question.options ?? (question.type === "true-false" ? ["True", "False"] : []);

  return (
    <RadioGroup
      value={value}
      onValueChange={onChange}
      aria-label={`Answer for question ${index + 1}`}
      className={cn(question.type === "true-false" && "sm:grid-cols-2")}
    >
      {options.map((option, optionIndex) => {
        const id = `answer-${question.id}-${optionIndex}`;
        const selected = value === option;
        return (
          <label
            key={option}
            htmlFor={id}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-xl border px-4 py-3 text-sm transition",
              "has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
              selected
                ? "border-primary bg-primary/10"
                : "bg-background hover:border-foreground/20",
            )}
          >
            <RadioGroupItem id={id} value={option} className="mt-0.5" />
            <span>
              <MathText text={option} />
            </span>
          </label>
        );
      })}
    </RadioGroup>
  );
}

function QuestionNav({
  questions,
  answers,
  index,
  onPick,
}: {
  questions: QuizQuestion[];
  answers: Record<string, string>;
  index: number;
  onPick: (index: number) => void;
}) {
  return (
    <div
      className="grid grid-cols-5 gap-1.5 sm:grid-cols-6"
      role="group"
      aria-label="Question navigator"
    >
      {questions.map((q, i) => {
        const answered = (answers[q.id] ?? "").trim() !== "";
        const current = i === index;
        return (
          <button
            key={q.id}
            type="button"
            onClick={() => onPick(i)}
            aria-current={current ? "true" : undefined}
            aria-label={`Question ${i + 1}${answered ? ", answered" : ", unanswered"}`}
            className={cn(
              "flex h-9 items-center justify-center rounded-lg border text-sm tabular-nums transition",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              current
                ? "border-primary bg-primary text-primary-foreground"
                : answered
                  ? "border-primary/40 bg-primary/10 text-primary hover:border-primary/60"
                  : "border-border bg-background text-muted-foreground hover:border-foreground/30 hover:text-foreground",
            )}
          >
            {i + 1}
          </button>
        );
      })}
    </div>
  );
}
