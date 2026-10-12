import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ClipboardList, Plus, Timer, CalendarDays, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAssessments, useCreateAssessment } from "@/lib/queries";
import { EmptyState, Modal, PageHeader, ProgressBar, masteryTone } from "@/components/ui/kit";
import { Field, scoreTone } from "@/components/practice/Builder";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/courses/$courseId/assessments")({
  component: Assessments,
});

const blankAssessment = { name: "", topics: "", score: "0", total: "0", duration: "0" };

function Assessments() {
  const { courseId } = Route.useParams();
  const assessments = useAssessments(courseId);
  const create = useCreateAssessment(courseId);
  const list = assessments.data ?? [];
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(blankAssessment);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error("Give the assessment a name.");
      return;
    }
    const topics = form.topics.split(",").map((t) => t.trim()).filter(Boolean);
    try {
      await create.mutateAsync({
        name: form.name.trim(),
        topics,
        score: Math.max(0, Number(form.score) || 0),
        total: Math.max(0, Number(form.total) || 0),
        duration_minutes: Math.max(0, Number(form.duration) || 0),
      });
      toast.success("Assessment saved.");
      setForm(blankAssessment);
      setOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save the assessment.");
    }
  };

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
        <EmptyState icon={ClipboardList} title="No assessments yet" body="Record a mock exam to track your score across topics."
          action={<button className="btn btn-primary" onClick={() => setOpen(true)}>Create Assessment</button>} />
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

      <Modal open={open} onOpenChange={setOpen} title="Create Assessment" description="Log a timed, multi-topic mock exam for this course.">
        <form onSubmit={submit} className="space-y-4">
          <Field label="Assessment name">
            <input className="field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Midterm Mock" autoFocus />
          </Field>
          <Field label="Topics (comma-separated)">
            <input className="field" value={form.topics} onChange={(e) => setForm({ ...form, topics: e.target.value })} placeholder="e.g. Recursion, Sorting, Graphs" />
          </Field>
          <div className="grid grid-cols-3 gap-4">
            <Field label="Score">
              <input type="number" min={0} className="field" value={form.score} onChange={(e) => setForm({ ...form, score: e.target.value })} />
            </Field>
            <Field label="Total">
              <input type="number" min={0} className="field" value={form.total} onChange={(e) => setForm({ ...form, total: e.target.value })} />
            </Field>
            <Field label="Duration (min)">
              <input type="number" min={0} className="field" value={form.duration} onChange={(e) => setForm({ ...form, duration: e.target.value })} />
            </Field>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)} disabled={create.isPending}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={create.isPending}>
              {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}Save assessment
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
