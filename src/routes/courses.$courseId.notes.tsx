import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { NotebookPen, RefreshCw, Check, Loader2, FileText, Sparkles } from "lucide-react";
import { getNotes, useStore } from "@/lib/store";
import { EmptyState, PageHeader } from "@/components/ui/kit";

export const Route = createFileRoute("/courses/$courseId/notes")({
  component: Notes,
});

type Phase = "idle" | "analyzing" | "updating" | "done";

function Notes() {
  const { courseId } = Route.useParams();
  const { materials } = useStore();
  const notes = getNotes(courseId);
  const newFiles = materials.filter((m) => m.courseId === courseId && m.added === "Just now").map((m) => m.name);
  const sources = newFiles.length ? newFiles : ["Lecture_06.pdf", "Lecture_06.pptx"];
  const [phase, setPhase] = useState<Phase>("idle");

  const run = () => {
    // Mock pipeline — will call the note-generation API later.
    setPhase("analyzing");
    setTimeout(() => setPhase("updating"), 1600);
    setTimeout(() => setPhase("done"), 3400);
  };

  return (
    <div>
      <PageHeader title="AI Notes" subtitle="Your course notes, automatically organized from your learning materials." />

      {notes.length > 0 && (
        <div className="card glow-bg mb-6 overflow-hidden p-5">
          {phase === "idle" && (
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl bg-primary/15 text-primary"><Sparkles className="h-4 w-4" /></span>
                <div>
                  <div className="font-medium">New material detected</div>
                  <p className="text-sm text-muted-foreground">Your course notes may be outdated.</p>
                </div>
              </div>
              <button className="btn btn-primary" onClick={run}><RefreshCw className="h-4 w-4" />Update Notes</button>
            </div>
          )}
          {(phase === "analyzing" || phase === "updating") && (
            <div>
              <div className="flex items-center gap-3 text-sm">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                {phase === "analyzing" ? "Analyzing new material…" : "Updating notes…"}
              </div>
              <div className="mt-4 h-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary transition-all duration-[1600ms] ease-out" style={{ width: phase === "analyzing" ? "45%" : "92%" }} />
              </div>
            </div>
          )}
          {phase === "done" && (
            <div className="fade-up">
              <div className="flex items-center gap-2 font-medium text-success"><Check className="h-4 w-4" />Notes updated successfully</div>
              <div className="mt-3 text-xs text-muted-foreground">Updated from:</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {sources.map((s) => <span key={s} className="chip"><FileText className="h-3 w-3" />{s}</span>)}
              </div>
            </div>
          )}
        </div>
      )}

      {notes.length === 0 ? (
        <EmptyState icon={NotebookPen} title="No AI notes yet." body="Upload your first course material to start generating notes."
          action={<Link to="/courses/$courseId/materials" params={{ courseId }} className="btn btn-primary">Add Materials</Link>} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {notes.map((n, i) => (
            <div key={n.id} className="card lift fade-up flex flex-col p-5" style={{ animationDelay: `${i * 50}ms` }}>
              <div className="flex items-center justify-between">
                <NotebookPen className="h-5 w-5 text-primary" />
                <span className="text-xs text-muted-foreground">Updated {phase === "done" && i === 1 ? "just now" : n.updated}</span>
              </div>
              <h3 className="mt-4 text-lg font-medium">{n.title}</h3>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {n.topics.map((t) => <span key={t} className="chip">{t}</span>)}
              </div>
              <button className="btn btn-ghost mt-6 self-start">Open Notes</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
