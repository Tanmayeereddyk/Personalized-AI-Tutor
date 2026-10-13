import { createFileRoute, useNavigate, useRouterState } from "@tanstack/react-router";
import { useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  FolderOpen,
  Loader2,
  NotebookPen,
  Plus,
  Trash2,
  UploadCloud,
} from "lucide-react";
import { toast } from "sonner";

import {
  useDeleteMaterial,
  useGenerateNotes,
  useMaterials,
  useUploadMaterials,
} from "@/lib/queries";
import { useCourse } from "@/lib/store";
import type { Material } from "@/lib/types";
import { StudySurface } from "@/components/study/StudySurface";
import { useStoredStudyView } from "@/lib/study-view";
import { EmptyState, Modal, PageHeader } from "@/components/ui/kit";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/courses/$courseId/materials")({
  component: Materials,
});

export function StatusChip({ status }: { status: Material["status"] }) {
  if (status === "ready")
    return (
      <span className="chip text-success">
        <CheckCircle2 className="h-3 w-3" />
        Ready
      </span>
    );
  if (status === "processing")
    return (
      <span className="chip text-primary">
        <Loader2 className="h-3 w-3 animate-spin" />
        Processing…
      </span>
    );
  return (
    <span className="chip text-warning">
      <AlertCircle className="h-3 w-3" />
      Needs attention
    </span>
  );
}

export function Materials() {
  const { courseId } = Route.useParams();
  const navigate = useNavigate();
  const course = useCourse(courseId);
  const materials = useMaterials(courseId);
  const upload = useUploadMaterials(courseId);
  const generate = useGenerateNotes(courseId);
  const remove = useDeleteMaterial(courseId);

  const list = materials.data ?? [];
  const [open, setOpen] = useState(false);
  const [drag, setDrag] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [view, setView] = useStoredStudyView("studyai.materials.view", "split");
  const input = useRef<HTMLInputElement>(null);

  // The open material is carried in the URL hash (e.g. #<materialId>) so it can
  // be shared and survives a reload, without making `search` mandatory for
  // every link that points at this page.
  const requested = useRouterState({
    select: (s) => s.location.hash.replace(/^#/, ""),
  });
  const selected = (requested ? list.find((m) => m.id === requested) : undefined) ?? list[0];

  const selectMaterial = (id: string) => {
    setSelectedNoteId(null);
    void navigate({
      to: "/courses/$courseId/materials",
      params: { courseId },
      hash: id,
      replace: true,
    });
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    try {
      const saved = await upload.mutateAsync(Array.from(files));
      setRecent((r) => [...saved.map((m) => m.id), ...r]);
      toast.success(
        `${saved.length} file${saved.length === 1 ? "" : "s"} uploaded. We'll process ${saved.length === 1 ? "it" : "them"} in the background.`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      if (input.current) input.current.value = "";
    }
  };

  const generateNotes = async () => {
    if (!selected) return;
    try {
      await generate.mutateAsync({ materialId: selected.id });
      setSelectedNoteId(null);
      toast.success("Notes generated from this material.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't generate notes.");
    }
  };

  const removeMaterial = async () => {
    if (!selected) return;
    try {
      await remove.mutateAsync(selected.id);
      setConfirmDelete(false);
      toast.success("Material removed.");
      void navigate({
        to: "/courses/$courseId/materials",
        params: { courseId },
        hash: "",
        replace: true,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove the material.");
    }
  };

  const processing = selected?.status === "processing";

  return (
    <div>
      <PageHeader
        title="Course Materials"
        subtitle="Read the file beside your notes and the tutor, or add new slides, textbooks and recordings."
        action={
          <button className="btn btn-primary" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" />
            Add Files
          </button>
        }
      />

      {materials.isLoading ? (
        <div className="card px-6 py-16 text-center text-sm text-muted-foreground">
          Loading materials…
        </div>
      ) : materials.isError ? (
        <div className="card px-6 py-16 text-center">
          <p className="font-medium">Couldn't load materials</p>
          <p className="mt-1 text-sm text-muted-foreground">{(materials.error as Error).message}</p>
          <button className="btn btn-primary mt-5" onClick={() => materials.refetch()}>
            Try again
          </button>
        </div>
      ) : list.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title="No materials yet"
          body="Upload slides, PDFs or lecture videos to keep everything for this course in one place."
          action={
            <button className="btn btn-primary" onClick={() => setOpen(true)}>
              Add Materials
            </button>
          }
        />
      ) : (
        <>
          <div className="card mb-4 flex flex-wrap items-center gap-2 p-3">
            <select
              className="field max-w-sm"
              value={selected?.id ?? ""}
              onChange={(e) => selectMaterial(e.target.value)}
              aria-label="Choose which material to open"
            >
              {list.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
            {selected ? <StatusChip status={selected.status} /> : null}
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <button
                className="btn btn-ghost"
                onClick={() => void generateNotes()}
                disabled={generate.isPending || processing}
                title="Write AI notes from this material"
              >
                {generate.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <NotebookPen className="h-4 w-4" />
                )}
                Generate notes
              </button>
              <button
                className="btn btn-ghost text-destructive"
                onClick={() => setConfirmDelete(true)}
                disabled={remove.isPending}
              >
                <Trash2 className="h-4 w-4" />
                Remove
              </button>
            </div>
          </div>

          <StudySurface
            courseId={courseId}
            courseCode={course?.code ?? "Course"}
            material={selected}
            view={view}
            onViewChange={setView}
            selectedNoteId={selectedNoteId}
            onSelectNote={setSelectedNoteId}
            onBack={() => setSelectedNoteId(null)}
            onGenerateNotes={() => void generateNotes()}
            generating={generate.isPending}
            onOpenMaterial={(id) => {
              selectMaterial(id);
              setView("material");
            }}
          />
        </>
      )}

      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Add course materials"
        description="Files are stored privately in your own account."
        wide
      >
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            void handleFiles(e.dataTransfer.files);
          }}
          className={cn(
            "flex flex-col items-center rounded-2xl border-2 border-dashed px-6 py-12 text-center transition",
            drag ? "border-primary bg-primary/5" : "border-foreground/15",
          )}
        >
          <span
            className={cn(
              "flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary text-primary transition",
              drag && "scale-110",
            )}
          >
            {upload.isPending ? (
              <Loader2 className="h-7 w-7 animate-spin" />
            ) : (
              <UploadCloud className="h-7 w-7" />
            )}
          </span>
          <p className="mt-4 font-medium">
            {upload.isPending ? "Uploading…" : "Drag & drop your course materials here"}
          </p>
          <p className="my-3 text-xs text-muted-foreground">or</p>
          <button
            className="btn btn-primary"
            onClick={() => input.current?.click()}
            disabled={upload.isPending}
          >
            Browse Files
          </button>
          <input
            ref={input}
            type="file"
            multiple
            className="hidden"
            accept=".pdf,.ppt,.pptx,.doc,.docx,.mp4,.mov,.webm,.mkv"
            onChange={(e) => void handleFiles(e.target.files)}
          />
          <p className="mt-4 font-mono text-xs text-muted-foreground">
            PDF · PPTX · DOCX · MP4 · MOV · WEBM · MKV
          </p>
        </div>
        {recent.length > 0 && (
          <div className="mt-5 space-y-2">
            {recent.map((id) => {
              const m = list.find((x) => x.id === id);
              if (!m) return null;
              return (
                <div
                  key={id}
                  className="flex items-center gap-3 rounded-xl border bg-background px-3 py-2.5"
                >
                  <span className="flex-1 truncate text-sm">{m.name}</span>
                  <StatusChip status={m.status} />
                </div>
              );
            })}
          </div>
        )}
        <div className="mt-6 flex justify-end">
          <button className="btn btn-ghost" onClick={() => setOpen(false)}>
            Done
          </button>
        </div>
      </Modal>

      <Modal
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Remove this material?"
        description={`“${selected?.name ?? "This file"}” will be deleted from this course, its processed content and storage. This can't be undone.`}
      >
        <div className="flex justify-end gap-2">
          <button
            className="btn btn-ghost"
            onClick={() => setConfirmDelete(false)}
            disabled={remove.isPending}
          >
            Cancel
          </button>
          <button
            className="btn bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={remove.isPending}
            onClick={() => void removeMaterial()}
          >
            {remove.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            Remove
          </button>
        </div>
      </Modal>
    </div>
  );
}
