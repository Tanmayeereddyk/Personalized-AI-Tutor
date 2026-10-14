import { useState, type ReactNode } from "react";
import {
  ArrowLeft,
  Download,
  ExternalLink,
  File,
  FileText,
  FolderOpen,
  Trash2,
  Loader2,
  NotebookPen,
  Presentation,
  Sparkles,
  Video,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { MarkdownDocument } from "@/components/notes/MarkdownDocument";
import { PdfViewer } from "@/components/notes/PdfViewer";
import { useDeleteNote, useMaterials, useNotes } from "@/lib/queries";
import type { MaterialType, Note } from "@/lib/types";
import { cn } from "@/lib/utils";

interface NotesPanelProps {
  courseId: string;
  selectedNoteId: string | null;
  onSelectNote: (id: string) => void;
  onBack: () => void;
  /** When omitted the header has no close button (the panel is always shown). */
  onClose?: (() => void) | undefined;
  /** When provided, a "Generate notes" action appears in the header/empty state. */
  onGenerate?: (() => void) | undefined;
  generating?: boolean | undefined;
  /**
   * When given, clicking a material delegates opening it to the caller
   * (e.g. to swap the material shown in the study split view) instead of
   * opening the file in a new tab.
   */
  onOpenMaterial?: ((id: string) => void) | undefined;
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

function hideGeneratedSourcesSection(markdown: string): string {
  const lines = markdown.split("\n");
  let sourcesIndex = -1;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (line && /^#{1,6}\s+sources\s*$/i.test(line.trim())) {
      sourcesIndex = index;
      break;
    }
  }
  if (sourcesIndex < 0) return markdown;
  const trailingLines = lines.slice(sourcesIndex + 1);
  if (!trailingLines.every((line) => !line.trim() || /^\s*[-*+]\s+/.test(line))) return markdown;
  return lines.slice(0, sourcesIndex).join("\n").trimEnd();
}

export function NotesPanel({
  courseId,
  selectedNoteId,
  onSelectNote,
  onBack,
  onClose,
  onGenerate,
  generating = false,
  onOpenMaterial,
}: NotesPanelProps) {
  const notes = useNotes(courseId);
  const deleteNote = useDeleteNote(courseId);
  const materials = useMaterials(courseId);
  const [opening, setOpening] = useState<string | null>(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [pdfNote, setPdfNote] = useState<Note | null>(null);

  const noteList = notes.data ?? [];
  const materialList = materials.data ?? [];
  const loading = notes.isLoading || materials.isLoading;
  const error = notes.error ?? materials.error;
  const selected: Note | undefined = selectedNoteId
    ? noteList.find((n) => n.id === selectedNoteId)
    : undefined;

  const openMaterial = async (id: string) => {
    if (onOpenMaterial) {
      onOpenMaterial(id);
      return;
    }
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

  const openPdf = (note: Note) => {
    setPdfNote(note);
  };

  const downloadPdf = async (note: Note) => {
    setDownloadingPdf(true);
    try {
      await api.notes.downloadPdf(note.id, note.title);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not download the PDF.");
    } finally {
      setDownloadingPdf(false);
    }
  };

  const removeNote = async (note: Note) => {
    if (!window.confirm(`Delete “${note.title}”? This cannot be undone.`)) return;
    try {
      await deleteNote.mutateAsync(note.id);
      if (selectedNoteId === note.id) onBack();
      toast.success("Note deleted");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete the note.");
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
        {onGenerate ? (
          <button
            type="button"
            onClick={onGenerate}
            disabled={generating}
            className="btn btn-ghost px-2 py-1.5 text-xs"
            aria-label="Generate notes"
            title="Generate notes"
          >
            {generating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
          </button>
        ) : null}
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="btn btn-ghost -mr-1 px-2 py-1.5"
            aria-label="Close notes panel"
            title="Close notes"
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
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
          <div className="px-4 py-5">
            <div className="mb-3 flex flex-wrap items-center gap-1.5">
              {selected.topics.map((t) => (
                <span key={t} className="chip">
                  {t}
                </span>
              ))}
              {selected.content ? (
                <div className="ml-auto flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => openPdf(selected)}
                    disabled={downloadingPdf}
                    className="btn btn-ghost px-2 py-1 text-xs"
                    title="Open this note as a PDF"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    <span className="ml-1.5">Open PDF</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void downloadPdf(selected)}
                    disabled={downloadingPdf}
                    className="btn btn-ghost px-2 py-1 text-xs"
                    title="Download this note as a PDF"
                  >
                    {downloadingPdf ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Download className="h-3.5 w-3.5" />
                    )}
                    <span className="ml-1.5">Download</span>
                  </button>
                </div>
              ) : null}
            </div>
            {selected.content ? (
              <div className="rounded-2xl border bg-card px-5 py-6 shadow-sm">
                <MarkdownDocument
                  markdown={selected.generated ? hideGeneratedSourcesSection(selected.content) : selected.content}
                />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">This note has no content saved yet.</p>
            )}
          </div>
        ) : (
          <div className="pb-4">
            <SectionLabel>Notes</SectionLabel>
            {noteList.length === 0 ? (
              <div className="px-4 pb-1">
                <p className="text-sm text-muted-foreground">
                  No notes yet. Generate notes from your materials and they will show up here.
                </p>
                {onGenerate ? (
                  <button
                    type="button"
                    onClick={onGenerate}
                    disabled={generating}
                    className="btn btn-primary mt-4"
                  >
                    {generating ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4" />
                    )}
                    {generating ? "Generating…" : "Generate notes"}
                  </button>
                ) : null}
              </div>
            ) : (
              <ul className="px-2">
                {noteList.map((n) => (
                  <li key={n.id} className="group flex items-center gap-1 rounded-xl pr-1 transition-colors hover:bg-secondary">
                    <button
                      type="button"
                      onClick={() => onSelectNote(n.id)}
                      className={cn(
                        "flex min-w-0 flex-1 items-start gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors",
                        selectedNoteId === n.id && "bg-secondary",
                      )}
                    >
                      <NotebookPen className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{n.title}</span>
                        <span className="block text-xs text-muted-foreground">Updated {n.updated}</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => void removeNote(n)}
                      disabled={deleteNote.isPending}
                      className="btn btn-ghost shrink-0 p-2 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-50"
                      aria-label={`Delete ${n.title}`}
                      title="Delete note"
                    >
                      {deleteNote.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
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

      <PdfViewer note={pdfNote} onClose={() => setPdfNote(null)} />
    </div>
  );
}
