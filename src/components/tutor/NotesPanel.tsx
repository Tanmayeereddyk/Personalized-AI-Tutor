import { useState, type ReactNode } from "react";
import {
  ArrowLeft,
  ExternalLink,
  File,
  FileText,
  FolderOpen,
  Loader2,
  NotebookPen,
  Presentation,
  Video,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { useMaterials, useNotes } from "@/lib/queries";
import type { MaterialType, Note } from "@/lib/types";
import { cn } from "@/lib/utils";

interface NotesPanelProps {
  courseId: string;
  selectedNoteId: string | null;
  onSelectNote: (id: string) => void;
  onBack: () => void;
  onClose: () => void;
}

const typeIcon: Record<MaterialType, typeof FileText> = {
  pdf: FileText,
  ppt: Presentation,
  video: Video,
  doc: File,
};
const typeColor: Record<MaterialType, string> = {
  pdf: "text-course-rose",
  ppt: "text-course-amber",
  video: "text-course-violet",
  doc: "text-course-sky",
};

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="px-4 pb-1 pt-4 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  );
}

export function NotesPanel({
  courseId,
  selectedNoteId,
  onSelectNote,
  onBack,
  onClose,
}: NotesPanelProps) {
  const notes = useNotes(courseId);
  const materials = useMaterials(courseId);
  const [opening, setOpening] = useState<string | null>(null);

  const noteList = notes.data ?? [];
  const materialList = materials.data ?? [];
  const loading = notes.isLoading || materials.isLoading;
  const error = notes.error ?? materials.error;
  const selected: Note | undefined = selectedNoteId
    ? noteList.find((n) => n.id === selectedNoteId)
    : undefined;

  const openMaterial = async (id: string) => {
    setOpening(id);
    try {
      const url = await api.materials.url(id);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not open the file.");
    } finally {
      setOpening(null);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex shrink-0 items-center gap-2 border-b px-4 py-3.5">
        {selected ? (
          <button
            type="button"
            onClick={onBack}
            className="btn btn-ghost -ml-1 px-2 py-1.5 text-xs"
            aria-label="Back to notes and materials"
            title="Back"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        ) : (
          <NotebookPen className="h-4 w-4 shrink-0 text-primary" />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            {selected ? selected.title : "Notes & materials"}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {selected ? `Updated ${selected.updated}` : "Reference while you study"}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="btn btn-ghost -mr-1 px-2 py-1.5"
          aria-label="Close notes panel"
          title="Close notes"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center gap-2 px-6 py-16 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading notes…
          </div>
        ) : error ? (
          <div className="px-6 py-16 text-center">
            <p className="font-medium">Couldn't load notes</p>
            <p className="mt-1 text-sm text-muted-foreground">{(error as Error).message}</p>
            <button
              className="btn btn-primary mt-5"
              onClick={() => {
                void notes.refetch();
                void materials.refetch();
              }}
            >
              Try again
            </button>
          </div>
        ) : selected ? (
          <div className="px-5 py-5">
            {selected.topics.length > 0 && (
              <div className="mb-4 flex flex-wrap gap-1.5">
                {selected.topics.map((t) => (
                  <span key={t} className="chip">
                    {t}
                  </span>
                ))}
              </div>
            )}
            {selected.content ? (
              <div className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                {selected.content}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                This note has no content saved yet. Automatic note generation isn't available in
                this build, so nothing is invented to fill the space.
              </p>
            )}
          </div>
        ) : (
          <div className="pb-4">
            <SectionLabel>Notes</SectionLabel>
            {noteList.length === 0 ? (
              <p className="px-4 pb-1 text-sm text-muted-foreground">
                No notes yet. Automatic note generation isn't available in this build.
              </p>
            ) : (
              <ul className="px-2">
                {noteList.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => onSelectNote(n.id)}
                      className={cn(
                        "flex w-full items-start gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors hover:bg-secondary",
                        selectedNoteId === n.id && "bg-secondary",
                      )}
                    >
                      <NotebookPen className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{n.title}</span>
                        <span className="block text-xs text-muted-foreground">
                          Updated {n.updated}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <SectionLabel>Materials</SectionLabel>
            {materialList.length === 0 ? (
              <p className="px-4 pb-1 text-sm text-muted-foreground">
                No materials yet. Upload slides, PDFs or videos to study alongside the tutor.
              </p>
            ) : (
              <ul className="px-2">
                {materialList.map((m) => {
                  const Icon = typeIcon[m.type];
                  return (
                    <li key={m.id}>
                      <button
                        type="button"
                        onClick={() => void openMaterial(m.id)}
                        disabled={opening === m.id}
                        className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors hover:bg-secondary"
                        title={`Open ${m.name}`}
                      >
                        <Icon className={cn("h-4 w-4 shrink-0", typeColor[m.type])} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{m.name}</span>
                          <span className="block text-xs text-muted-foreground">
                            {m.kind} · {m.meta}
                          </span>
                        </span>
                        {opening === m.id ? (
                          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
                        ) : (
                          <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}

            {noteList.length === 0 && materialList.length === 0 && (
              <div className="px-4 pt-4">
                <div className="flex items-center gap-2 rounded-xl border border-dashed px-3.5 py-3 text-xs text-muted-foreground">
                  <FolderOpen className="h-4 w-4 shrink-0" />
                  <span>Nothing to show yet — add materials to build up this course.</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
