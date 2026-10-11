import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ListChecks, Plus, Sparkles } from "lucide-react";
import { useQuizzes } from "@/lib/queries";
import { EmptyState, Modal, PageHeader } from "@/components/ui/kit";
import { scoreBorder, scoreTone } from "@/components/practice/Builder";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/courses/$courseId/quizzes")({
  component: Quizzes,
});

function Quizzes() {
  const { courseId } = Route.useParams();
  const quizzes = useQuizzes(courseId);
  const list = quizzes.data ?? [];
  const [open, setOpen] = useState(false);

  return (
    <div>
      <PageHeader title="Quizzes" subtitle="Short, topic-level practice to sharpen weak spots."
        action={<button className="btn btn-primary" onClick={() => setOpen(true)}><Plus className="h-4 w-4" />Create Quiz</button>} />

      {quizzes.isLoading ? (
        <div className="card px-6 py-16 text-center text-sm text-muted-foreground">Loading quizzes…</div>
      ) : quizzes.isError ? (
        <div className="card px-6 py-16 text-center">
          <p className="font-medium">Couldn't load quizzes</p>
          <p className="mt-1 text-sm text-muted-foreground">{(quizzes.error as Error).message}</p>
          <button className="btn btn-primary mt-5" onClick={() => quizzes.refetch()}>Try again</button>
        </div>
      ) : list.length === 0 ? (
        <EmptyState icon={ListChecks} title="No quizzes attempted yet." body="Quiz generation isn't available yet, so there are no attempts to show. Your results will appear here once it is."
          action={<button className="btn btn-primary" onClick={() => setOpen(true)}>About quizzes</button>} />
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

      <Modal open={open} onOpenChange={setOpen} title="Create a Quiz" description="Quizzes are generated from this course's materials.">
        <div className="flex flex-col items-center py-8 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary text-primary"><Sparkles className="h-6 w-6" /></span>
          <h3 className="mt-4 text-lg font-medium">Quiz generation isn't available yet</h3>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            This feature will build practice questions from your uploaded materials. It isn't enabled yet, so no quiz is created.
          </p>
          <button className="btn btn-primary mt-6" onClick={() => setOpen(false)}>Got it</button>
        </div>
      </Modal>
    </div>
  );
}
