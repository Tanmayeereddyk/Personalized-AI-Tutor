import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ClipboardList, Plus, Timer, CalendarDays, CheckCircle2 } from "lucide-react";
import { getAssessments, getTopics } from "@/lib/store";
import type { Difficulty } from "@/lib/types";
import { EmptyState, Modal, PageHeader, ProgressBar, masteryTone } from "@/components/ui/kit";
import { CheckGrid, Field, PillGroup, scoreTone } from "@/components/practice/Builder";
import { Generating } from "./courses.$courseId.quizzes";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/courses/$courseId/assessments")({
  component: Assessments,
});

function Assessments() {
  const { courseId } = Route.useParams();
  const list = getAssessments(courseId);
  const groups = Array.from(new Set(getTopics(courseId).map((t) => t.group)));
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<"config" | "loading" | "ready">("config");
  const [sel, setSel] = useState<string[]>([]);
  const [diff, setDiff] = useState<Difficulty>("Mixed");
  const [duration, setDuration] = useState(60);
  const [qs, setQs] = useState(30);
  const [types, setTypes] = useState<string[]>(["MCQ", "Short Answer"]);

  const start = () => { setStage("config"); setOpen(true); };

  return (
    <div>
      <PageHeader title="Assessments" subtitle="Full-length mock exams that test you across multiple topics."
        action={<button className="btn btn-primary" onClick={start}><Plus className="h-4 w-4" />Create Assessment</button>} />

      {list.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No assessments yet" body="Create a timed mock exam to see how ready you are."
          action={<button className="btn btn-primary" onClick={start}>Create Assessment</button>} />
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
                  <span className={cn("font-mono text-4xl font-semibold", scoreTone(a.score))}>{a.score}</span>
                  <span className="font-mono text-muted-foreground">/ {a.total}</span>
                </div>
                <ProgressBar value={a.score} tone={masteryTone(a.score)} className="mt-2" />
              </div>
              <button className="btn btn-ghost">Review Assessment</button>
            </div>
          ))}
        </div>
      )}

      <Modal open={open} onOpenChange={setOpen} title="Create Assessment" description="A timed, multi-topic mock exam." wide>
        {stage === "config" && (
          <div className="space-y-6">
            <Field label="Choose topics"><CheckGrid options={groups} value={sel} onChange={setSel} /></Field>
            <Field label="Difficulty"><PillGroup options={["Easy", "Medium", "Hard", "Mixed"] as const} value={diff} onChange={setDiff} /></Field>
            <div className="grid gap-6 sm:grid-cols-2">
              <Field label="Duration"><PillGroup options={[15, 30, 60, 90] as const} value={duration} onChange={setDuration} format={(v) => `${v} min`} /></Field>
              <Field label="Questions"><PillGroup options={[10, 20, 30, 50] as const} value={qs} onChange={setQs} /></Field>
            </div>
            <Field label="Question types"><CheckGrid options={["MCQ", "Short Answer", "Numerical"]} value={types} onChange={setTypes} /></Field>
            <div className="flex justify-end gap-2">
              <button className="btn btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={!sel.length || !types.length} onClick={() => { setStage("loading"); setTimeout(() => setStage("ready"), 1800); }}>Create Assessment</button>
            </div>
          </div>
        )}
        {stage === "loading" && <Generating label="Assembling your assessment…" />}
        {stage === "ready" && (
          <div className="flex flex-col items-center py-8 text-center">
            <CheckCircle2 className="h-12 w-12 text-success" />
            <h3 className="mt-4 text-lg font-medium">Assessment ready</h3>
            <p className="mt-1 text-sm text-muted-foreground">{qs} questions · {duration} min · {diff} · {sel.join(", ")}</p>
            <button className="btn btn-primary mt-6" onClick={() => setOpen(false)}><Timer className="h-4 w-4" />Start Assessment</button>
          </div>
        )}
      </Modal>
    </div>
  );
}
