import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ClipboardList, Plus, Timer, CalendarDays } from "lucide-react";
import { useAssessments } from "@/lib/queries";
import { EmptyState, Modal, PageHeader, ProgressBar, masteryTone } from "@/components/ui/kit";
import { scoreTone } from "@/components/practice/Builder";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/courses/$courseId/assessments")({
  component: Assessments,
});

function Assessments() {
  const { courseId } = Route.useParams();
  const assessments = useAssessments(courseId);
  const list = assessments.data ?? [];
  const [open, setOpen] = useState(false);

  return (
    <div>
      <PageHeader title="Assessments" subtitle="Full-length mock exams that test you across multiple topics."
        action={<button className="btn btn-primary" onClick={() => setOpen(true)}><Plus className="h-4 w-4" />Create Assessment</button>} />

      {assessments.isLoading ? (
        <div className="card px-6 py-16 text-center text-sm text-muted-foreground">Loading assessments…</div>
      ) : assessments.isError ? (
        <div className="card px-6 py-16 text-center">
          <p className="font-medium">Couldn't load assessments</p>
          <p className="mt-1 text-sm text-muted-foreground">{(assessments.error as Error).message}</p>
          <button className="btn btn-primary mt-5" onClick={() => assessments.refetch()}>Try again</button>
        </div>
      ) : list.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No assessments yet" body="Assessment generation isn't available yet, so no mock exams have been created. They'll appear here once it is."
          action={<button className="btn btn-primary" onClick={() => setOpen(true)}>About assessments</button>} />
      ) : (
        <div className="space-y-4">
          {list.map((a, i) => (
            <div key={a.id} className="card lift fade-up grid gap-6 p-6 md:grid-cols-[1fr_auto_auto] md:items-center" style={{ animationDelay: `${i * 60}ms` }}>
              <div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />{a.date}</span>
                  <span>·</span>
                  <span className="flex items-center gap-1"><Timer className="h-3.5 w-3.5" />{a.duration}</span>
                </div>
                <h3 className="mt-2 text-lg font-medium">{a.name}</h3>
                <div className="mt-3 flex flex-wrap gap-1.5">{a.topics.map((t) => <span key={t} className="chip">{t}</span>)}</div>
              </div>
              <div className="min-w-44">
                <div className="flex items-baseline gap-1">
                  <span className={cn("font-mono text-4xl font-semibold", scoreTone(a.total ? (a.score / a.total) * 100 : 0))}>{a.score}</span>
                  <span className="font-mono text-muted-foreground">/ {a.total}</span>
                </div>
                <ProgressBar value={a.total ? (a.score / a.total) * 100 : 0} tone={masteryTone(a.total ? (a.score / a.total) * 100 : 0)} className="mt-2" />
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={open} onOpenChange={setOpen} title="Create Assessment" description="A timed, multi-topic mock exam.">
        <div className="flex flex-col items-center py-8 text-center">
          <ClipboardList className="h-12 w-12 text-muted-foreground" />
          <h3 className="mt-4 text-lg font-medium">Assessment generation isn't available yet</h3>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            This feature will assemble a timed mock exam from your course topics. It isn't enabled yet, so no assessment is created.
          </p>
          <button className="btn btn-primary mt-6" onClick={() => setOpen(false)}>Got it</button>
        </div>
      </Modal>
    </div>
  );
}
