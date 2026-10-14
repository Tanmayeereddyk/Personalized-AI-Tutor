import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ListChecks, Loader2, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useDeleteQuiz, useQuizResult, useQuizzes, useSubmitQuiz } from "@/lib/queries";
import { EmptyState, Modal, PageHeader } from "@/components/ui/kit";
import { scoreBorder, scoreTone } from "@/components/practice/Builder";
import { QuizBuilder } from "@/components/practice/QuizBuilder";
import { QuizResultView } from "@/components/practice/QuizResultView";
import { QuizRunner } from "@/components/practice/QuizRunner";
import type { GeneratedQuiz } from "@/lib/quiz";
import type { Quiz } from "@/lib/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/courses/$courseId/quizzes")({
  component: Quizzes,
});

const percentFor = (quiz: Quiz): number =>
  quiz.percentage ?? (quiz.total ? Math.round((quiz.score / quiz.total) * 100) : 0);
export function Quizzes() {
  const { courseId } = Route.useParams();
  const quizzes = useQuizzes(courseId);
  const removeQuiz = useDeleteQuiz(courseId);
  const submitQuiz = useSubmitQuiz(courseId);
  const list = quizzes.data ?? [];
  // The generated quiz lives in local state only until it is submitted.
  const [builderOpen, setBuilderOpen] = useState(false);
  const [session, setSession] = useState<GeneratedQuiz | null>(null);

  // The saved attempt waiting for a confirmation before it is deleted for good.
  const [confirming, setConfirming] = useState<Quiz | null>(null);
  // A saved attempt opened for review (its answers, answers key and explanations).
  const [viewing, setViewing] = useState<Quiz | null>(null);
  const viewingResult = useQuizResult(
    viewing && viewing.source === "ai" ? viewing.id : null,
  );

  // Which row's delete button shows a spinner, if a delete is in flight.
  const deletingId = removeQuiz.isPending ? (removeQuiz.variables ?? null) : null;
  const deleteDescription = confirming
    ? `"${confirming.name}" and its score will be removed from this course. This can't be undone.`
    : "";

  const startQuiz = (quiz: GeneratedQuiz) => {
    setSession(quiz);
  };

  /**
   * Delete only after the user confirms, and only after the backend agrees.
   *
   * The row leaves the list on success; on failure it stays put with an error
   * toast. `removeQuiz.isPending` doubles as the duplicate-submit guard, and if
   * the open quiz session is the one being removed we return to the list.
   */
  const confirmDelete = async () => {
    const target = confirming;
    if (!target || removeQuiz.isPending) return;
    try {
      await removeQuiz.mutateAsync(target.id);
      setSession((current) => (current && current.id === target.id ? null : current));
      toast.success("Quiz attempt deleted.");
      setConfirming(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete the quiz.");
    }
  };

  const viewingPct = viewing ? percentFor(viewing) : 0;
  return (
    <div>
      <PageHeader
        title="Quizzes"
        subtitle="Generate AI practice from your topics and track your results."
        action={
          <button className="btn btn-primary" onClick={() => setBuilderOpen(true)}>
            <Sparkles className="h-4 w-4" />
            Generate Quiz
          </button>
        }
      />

      {quizzes.isLoading ? (
        <div className="card px-6 py-16 text-center text-sm text-muted-foreground">
          Loading quizzes…
        </div>
      ) : quizzes.isError ? (
        <div className="card px-6 py-16 text-center">
          <p className="font-medium">Couldn't load quizzes</p>
          <p className="mt-1 text-sm text-muted-foreground">{(quizzes.error as Error).message}</p>
          <button className="btn btn-primary mt-5" onClick={() => quizzes.refetch()}>
            Try again
          </button>
        </div>
      ) : list.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="No quizzes attempted yet."
          body="Generate an AI practice quiz from your topics to get started."
          action={
            <button className="btn btn-primary" onClick={() => setBuilderOpen(true)}>
              <Sparkles className="h-4 w-4" />
              Generate Quiz
            </button>
          }
        />
      ) : (
        <section>
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wider text-muted-foreground">
            Quiz History
          </h2>
          <ul className="space-y-2">
            {list.map((q) => {
              const pct = percentFor(q);
              return (
                <li
                  key={q.id}
                  className={cn(
                    "card flex items-center gap-4 border-l-2 px-4 py-3",
                    scoreBorder(pct),
                  )}
                >
                  <button
                    type="button"
                    className="min-w-0 flex-1 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => setViewing(q)}
                    aria-label={`Open ${q.name}`}
                  >
                    <p className="truncate font-medium">{q.name}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {q.date}
                      {q.source === "ai"
                        ? " · AI practice quiz"
                        : q.source === "manual"
                          ? " · Recorded attempt"
                          : " · Source unknown"}
                    </p>
                  </button>

                  <div className="shrink-0 text-right">
                    <div className="font-mono text-sm font-semibold tabular-nums">
                      {q.score}
                      <span className="text-muted-foreground"> / {q.total}</span>
                    </div>
                    <div className={cn("font-mono text-xs font-semibold", scoreTone(pct))}>
                      {pct}%
                    </div>
                  </div>

                  <button
                    type="button"
                    className="shrink-0 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:pointer-events-none disabled:opacity-50"
                    onClick={() => setConfirming(q)}
                    disabled={deletingId !== null}
                    aria-label={`Delete ${q.name}`}
                  >
                    {deletingId === q.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Reopen a saved attempt: answers, correct answers and explanations. */}
      <Modal
        open={viewing !== null}
        onOpenChange={(next) => {
          if (!next) setViewing(null);
        }}
        size="lg"
        title={viewing?.name ?? "Quiz result"}
        description={
          viewing
            ? `${viewing.date} · ${viewing.score} / ${viewing.total} (${viewingPct}%)`
            : "Review a saved quiz attempt."
        }
      >
        {viewing ? (
          viewing.source === "ai" ? (
            viewingResult.isLoading ? (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading your result…
              </div>
            ) : viewingResult.isError ? (
              <div className="py-8 text-center">
                <p className="font-medium">Couldn't load this result</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {(viewingResult.error as Error).message}
                </p>
                <button className="btn btn-primary mt-5" onClick={() => viewingResult.refetch()}>
                  Try again
                </button>
              </div>
            ) : viewingResult.data ? (
              <div className="max-h-[70vh] overflow-y-auto pr-1">
                <QuizResultView result={viewingResult.data} />
              </div>
            ) : null
          ) : viewing.source === "manual" ? (
            <p className="py-6 text-sm text-muted-foreground">
              This attempt was recorded manually, so only its score was saved. Generate an AI quiz
              to keep the full answers and explanations.
            </p>
          ) : (
            <p className="py-6 text-sm text-muted-foreground">
              The source for this attempt was not recorded, so only its saved score is available.
            </p>
          )
        ) : null}
      </Modal>

      {/* Confirm before a quiz attempt is permanently deleted. */}
      <Modal
        open={confirming !== null}
        onOpenChange={(next) => {
          if (!next && !removeQuiz.isPending) setConfirming(null);
        }}
        size="sm"
        title="Delete this quiz?"
        description={deleteDescription}
      >
        <div className="flex items-center justify-end gap-2 pt-4">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setConfirming(null)}
            disabled={removeQuiz.isPending}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void confirmDelete()}
            disabled={removeQuiz.isPending}
          >
            {removeQuiz.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            {removeQuiz.isPending ? "Deleting…" : "Delete quiz"}
          </button>
        </div>
      </Modal>

      {/* Quiz generation flow: choose topics, configure, then take the AI quiz. */}
      <QuizBuilder
        open={builderOpen}
        onOpenChange={setBuilderOpen}
        courseId={courseId}
        onGenerated={startQuiz}
      />

      {session ? (
        <QuizRunner
          key={session.id}
          quiz={session}
          onSubmit={(submission) =>
            submitQuiz.mutateAsync({ setId: session.setId, submission })
          }
          onExit={() => setSession(null)}
        />
      ) : null}
    </div>
  );
}
