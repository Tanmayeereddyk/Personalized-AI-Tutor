import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ListChecks, Plus, Loader2, Sparkles, ClipboardList } from "lucide-react";
import { toast } from "sonner";
import { useCreateQuiz, useQuizzes } from "@/lib/queries";
import { EmptyState, Modal, PageHeader } from "@/components/ui/kit";
import { Field, PillGroup, scoreBorder, scoreTone } from "@/components/practice/Builder";
import { QuizBuilder, type QuizStartInput } from "@/components/practice/QuizBuilder";
import { QuizRunner } from "@/components/practice/QuizRunner";
import { buildMockQuiz, type MockQuiz } from "@/lib/quiz-mock";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/courses/$courseId/quizzes")({
  component: Quizzes,
});

const blankQuiz = { name: "", topic: "", difficulty: "Medium", score: "0", total: "0" };

export function Quizzes() {
  const { courseId } = Route.useParams();
  const quizzes = useQuizzes(courseId);
  const create = useCreateQuiz(courseId);
  const list = quizzes.data ?? [];
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(blankQuiz);

  // The generated quiz lives in local state only; nothing is persisted.
  const [builderOpen, setBuilderOpen] = useState(false);
  const [session, setSession] = useState<MockQuiz | null>(null);

  const startQuiz = ({ material, config }: QuizStartInput) => {
    setSession(
      buildMockQuiz({
        courseId,
        materialId: material.id,
        materialName: material.name,
        config,
      }),
    );
    setBuilderOpen(false);
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
        subtitle="Generate practice from your materials, or log an attempt after class."
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
        <div className="card px-6 py-16 text-center text-sm text-muted-foreground">Loading quizzes…</div>
      ) : quizzes.isError ? (
        <div className="card px-6 py-16 text-center">
          <p className="font-medium">Couldn't load quizzes</p>
          <p className="mt-1 text-sm text-muted-foreground">{(quizzes.error as Error).message}</p>
          <button className="btn btn-primary mt-5" onClick={() => quizzes.refetch()}>Try again</button>
        </div>
      ) : list.length === 0 ? (
        <EmptyState icon={ListChecks} title="No quizzes attempted yet." body="Generate a practice quiz from your materials, or record an attempt to track your score."
          action={<button className="btn btn-primary" onClick={() => setBuilderOpen(true)}><Sparkles className="h-4 w-4" />Generate Quiz</button>} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((q, i) => {
            const pct = q.total ? Math.round((q.score / q.total) * 100) : 0;
            return (
              <div key={q.id} className={cn("card lift fade-up flex flex-col border-l-2 p-5", scoreBorder(pct))} style={{ animationDelay: `${i * 50}ms` }}>
                <h3 className="font-medium">{q.name}</h3>
                <div className="mt-1.5 flex flex-wrap gap-1.5"><span className="chip">{q.topic}</span><span className="chip">{q.difficulty}</span><span className="chip">{q.total} Qs</span></div>
                <div className="mt-6 flex items-end justify-between">
                  <div>
                    <div className="text-xs text-muted-foreground">Score</div>
                    <div className="font-mono text-2xl font-semibold">{q.score}<span className="text-muted-foreground"> / {q.total}</span></div>
                  </div>
                  <div className={cn("font-mono text-3xl font-semibold", scoreTone(pct))}>{pct}%</div>
                </div>
                <div className="mt-4 text-xs text-muted-foreground">Attempted {q.date}</div>
              </div>
            );
          })}
        </div>
      )}

      <Modal open={open} onOpenChange={setOpen} title="Record a Quiz" description="Log a quiz attempt for this course.">
        <form onSubmit={submit} className="space-y-4">
          <Field label="Quiz name">
            <input className="field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Sorting Algorithms" autoFocus />
          </Field>
          <Field label="Topic (optional)">
            <input className="field" value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} placeholder="e.g. Recursion" />
          </Field>
          <Field label="Difficulty">
            <PillGroup options={["Easy", "Medium", "Hard"]} value={form.difficulty} onChange={(v) => setForm({ ...form, difficulty: v })} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Score">
              <input type="number" min={0} className="field" value={form.score} onChange={(e) => setForm({ ...form, score: e.target.value })} />
            </Field>
            <Field label="Total questions">
              <input type="number" min={0} className="field" value={form.total} onChange={(e) => setForm({ ...form, total: e.target.value })} />
            </Field>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)} disabled={create.isPending}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={create.isPending}>
              {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Save quiz
            </button>
          </div>
        </form>
      </Modal>

      {/* Quiz generation flow: choose a material, configure, then take it. */}
      <QuizBuilder
        open={builderOpen}
        onOpenChange={setBuilderOpen}
        courseId={courseId}
        onStart={startQuiz}
      />

      {session ? (
        <QuizRunner
          key={session.id}
          quiz={session}
          onExit={() => setSession(null)}
        />
      ) : null}
    </div>
  );
}
