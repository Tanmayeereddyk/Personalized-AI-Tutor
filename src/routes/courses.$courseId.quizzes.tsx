import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ListChecks, Loader2, Sparkles, ClipboardList, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useCreateQuiz, useDeleteQuiz, useQuizzes } from "@/lib/queries";
import { EmptyState, Modal, PageHeader } from "@/components/ui/kit";
import { Field, PillGroup, scoreBorder, scoreTone } from "@/components/practice/Builder";
import { QuizBuilder } from "@/components/practice/QuizBuilder";
import { QuizRunner } from "@/components/practice/QuizRunner";
import type { GeneratedQuiz } from "@/lib/quiz";
import type { Quiz } from "@/lib/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/courses/$courseId/quizzes")({
  component: Quizzes,
});

const blankQuiz = { name: "", topic: "", difficulty: "Medium", score: "0", total: "0" };

export function Quizzes() {
  const { courseId } = Route.useParams();
  const quizzes = useQuizzes(courseId);
  const create = useCreateQuiz(courseId);
  const removeQuiz = useDeleteQuiz(courseId);
  const list = quizzes.data ?? [];
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(blankQuiz);

  // The generated quiz lives in local state only; nothing is persisted.
  const [builderOpen, setBuilderOpen] = useState(false);
  const [session, setSession] = useState<GeneratedQuiz | null>(null);

  // The quiz waiting for a confirmation before it is deleted for good.
  const [confirming, setConfirming] = useState<Quiz | null>(null);
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
      toast.success("Quiz deleted.");
      setConfirming(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete the quiz.");
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error("Give the quiz a name.");
      return;
    }
    try {
      await create.mutateAsync({
        name: form.name.trim(),
        topic: form.topic.trim() || undefined,
        difficulty: form.difficulty,
        score: Math.max(0, Number(form.score) || 0),
        total: Math.max(0, Number(form.total) || 0),
      });
      toast.success("Quiz attempt saved.");
      setForm(blankQuiz);
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the quiz.");
    }
  };

  return (
    <div>
      <PageHeader
        title="Quizzes"
        subtitle="Generate AI practice from your topics, or log an attempt after class."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <button className="btn btn-ghost" onClick={() => setOpen(true)}>
              <ClipboardList className="h-4 w-4" />
              Record attempt
            </button>
            <button className="btn btn-primary" onClick={() => setBuilderOpen(true)}>
              <Sparkles className="h-4 w-4" />
              Generate Quiz
            </button>
          </div>
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
          body="Generate an AI practice quiz from your topics, or record an attempt to track your score."
          action={
            <button className="btn btn-primary" onClick={() => setBuilderOpen(true)}>
              <Sparkles className="h-4 w-4" />
              Generate Quiz
            </button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((q, i) => {
            const pct = q.total ? Math.round((q.score / q.total) * 100) : 0;
            return (
              <div
                key={q.id}
                className={cn("card lift fade-up flex flex-col border-l-2 p-5", scoreBorder(pct))}
                style={{ animationDelay: `${i * 50}ms` }}
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="min-w-0 break-words font-medium">{q.name}</h3>
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
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <span className="chip">{q.topic}</span>
                  <span className="chip">{q.difficulty}</span>
                  <span className="chip">{q.total} Qs</span>
                </div>
                <div className="mt-6 flex items-end justify-between">
                  <div>
                    <div className="text-xs text-muted-foreground">Score</div>
                    <div className="font-mono text-2xl font-semibold">
                      {q.score}
                      <span className="text-muted-foreground"> / {q.total}</span>
                    </div>
                  </div>
                  <div className={cn("font-mono text-3xl font-semibold", scoreTone(pct))}>
                    {pct}%
                  </div>
                </div>
                <div className="mt-4 text-xs text-muted-foreground">Attempted {q.date}</div>
              </div>
            );
          })}
        </div>
      )}

      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Record a Quiz"
        description="Log a quiz attempt for this course."
      >
        <form onSubmit={submit} className="space-y-4">
          <Field label="Quiz name">
            <input
              className="field"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Sorting Algorithms"
              autoFocus
            />
          </Field>
          <Field label="Topic (optional)">
            <input
              className="field"
              value={form.topic}
              onChange={(e) => setForm({ ...form, topic: e.target.value })}
              placeholder="e.g. Recursion"
            />
          </Field>
          <Field label="Difficulty">
            <PillGroup
              options={["Easy", "Medium", "Hard"]}
              value={form.difficulty}
              onChange={(v) => setForm({ ...form, difficulty: v })}
            />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Score">
              <input
                type="number"
                min={0}
                className="field"
                value={form.score}
                onChange={(e) => setForm({ ...form, score: e.target.value })}
              />
            </Field>
            <Field label="Total questions">
              <input
                type="number"
                min={0}
                className="field"
                value={form.total}
                onChange={(e) => setForm({ ...form, total: e.target.value })}
              />
            </Field>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setOpen(false)}
              disabled={create.isPending}
            >
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={create.isPending}>
              {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Save quiz
            </button>
          </div>
        </form>
      </Modal>

      {/* Confirm before a quiz is permanently deleted. */}
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
          onExit={() => setSession(null)}
          onComplete={async (attempt) => {
            try {
              await create.mutateAsync(attempt);
              toast.success("Quiz attempt saved.");
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "Could not save quiz results.");
            }
          }}
        />
      ) : null}
    </div>
  );
}
