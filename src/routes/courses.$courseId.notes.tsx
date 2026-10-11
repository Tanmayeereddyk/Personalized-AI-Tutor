import { createFileRoute, Link } from "@tanstack/react-router";
import { NotebookPen, FileText } from "lucide-react";
import { useNotes } from "@/lib/queries";
import { EmptyState, PageHeader } from "@/components/ui/kit";

export const Route = createFileRoute("/courses/$courseId/notes")({
  component: Notes,
});

function Notes() {
  const { courseId } = Route.useParams();
  const notes = useNotes(courseId);
  const list = notes.data ?? [];

  return (
    <div>
      <PageHeader title="AI Notes" subtitle="Course notes generated from your learning materials." />

      <div className="card mb-6 flex items-start gap-3 p-5">
        <span className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl bg-secondary text-muted-foreground"><FileText className="h-4 w-4" /></span>
        <div>
          <div className="font-medium">Note generation isn't available yet</div>
          <p className="text-sm text-muted-foreground">
            Automatic notes are generated from your materials by the StudyAI service. It isn't enabled yet, so no notes are
            created for you. Anything already saved to your account appears below.
          </p>
        </div>
      </div>

      {notes.isLoading ? (
        <div className="card px-6 py-16 text-center text-sm text-muted-foreground">Loading notes…</div>
      ) : notes.isError ? (
        <div className="card px-6 py-16 text-center">
          <p className="font-medium">Couldn't load notes</p>
          <p className="mt-1 text-sm text-muted-foreground">{(notes.error as Error).message}</p>
          <button className="btn btn-primary mt-5" onClick={() => notes.refetch()}>Try again</button>
        </div>
      ) : list.length === 0 ? (
        <EmptyState icon={NotebookPen} title="No notes yet." body="Notes will appear here once automatic note generation is available. You can upload materials in the meantime."
          action={<Link to="/courses/$courseId/materials" params={{ courseId }} className="btn btn-primary">Manage Materials</Link>} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((n, i) => (
            <div key={n.id} className="card lift fade-up flex flex-col p-5" style={{ animationDelay: `${i * 50}ms` }}>
              <div className="flex items-center justify-between">
                <NotebookPen className="h-5 w-5 text-primary" />
                <span className="text-xs text-muted-foreground">Updated {n.updated}</span>
              </div>
              <h3 className="mt-4 text-lg font-medium">{n.title}</h3>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {n.topics.map((t) => <span key={t} className="chip">{t}</span>)}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
