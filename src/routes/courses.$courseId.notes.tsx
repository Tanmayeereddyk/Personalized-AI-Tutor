import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import { StudySurface } from "@/components/study/StudySurface";
import { useStoredStudyView } from "@/lib/study-view";
import { PageHeader } from "@/components/ui/kit";
import { useGenerateNotes, useMaterials } from "@/lib/queries";
import { useCourse } from "@/lib/store";
import { NOTES_PHASE_LABEL, type NotesPhase } from "@/lib/notes-generation";

export const Route = createFileRoute("/courses/$courseId/notes")({
  component: Notes,
});

export function Notes() {
  const { courseId } = Route.useParams();
  const course = useCourse(courseId);
  const materials = useMaterials(courseId);
  const generate = useGenerateNotes(courseId);

  const list = materials.data ?? [];
  const [materialId, setMaterialId] = useState("");
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [phase, setPhase] = useState<NotesPhase | null>(null);
  const [view, setView] = useStoredStudyView("studyai.notes.view", "notes");

  const material = list.find((m) => m.id === materialId) ?? list[0];

  const generateNotes = async () => {
    setPhase(null);
    try {
      await generate.mutateAsync({
        materialId: materialId || undefined,
        onPhase: setPhase,
      });
      setSelectedNoteId(null);
      toast.success("Notes generated from your materials.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't generate notes.");
    } finally {
      setPhase(null);
    }
  };

  const busyLabel = generate.isPending
    ? (phase ? NOTES_PHASE_LABEL[phase] : "Generating…")
    : "Generate Notes";

  return (
    <div>
      <PageHeader
        title="AI Notes"
        subtitle="Structured study notes written by the AI from your own materials, with sources."
        action={
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="field max-w-xs"
              value={materialId}
              onChange={(e) => setMaterialId(e.target.value)}
              aria-label="Choose which material to use"
            >
              <option value="">All materials in this course</option>
              {list.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            <button
              className="btn btn-primary"
              onClick={() => void generateNotes()}
              disabled={generate.isPending || list.length === 0}
            >
              {generate.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {busyLabel}
            </button>
          </div>
        }
      />

      {generate.isPending ? (
        <p role="status" aria-live="polite" className="mb-4 text-sm text-muted-foreground">
          {phase ? NOTES_PHASE_LABEL[phase] : "Generating…"}
        </p>
      ) : null}

      {generate.error ? (
        <p className="mb-4 text-sm text-destructive">{(generate.error as Error).message}</p>
      ) : null}

      <StudySurface
        courseId={courseId}
        courseCode={course?.code ?? "Course"}
        material={material}
        view={view}
        onViewChange={setView}
        selectedNoteId={selectedNoteId}
        onSelectNote={setSelectedNoteId}
        onBack={() => setSelectedNoteId(null)}
        onOpenMaterial={(id) => {
          setMaterialId(id);
          setView("material");
        }}
      />
    </div>
  );
}
