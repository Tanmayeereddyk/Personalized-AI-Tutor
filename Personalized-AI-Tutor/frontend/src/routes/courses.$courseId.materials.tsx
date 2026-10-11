import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import {
  FileText,
  Presentation,
  Video,
  File,
  Plus,
  UploadCloud,
  CheckCircle2,
  Loader2,
  AlertCircle,
  FolderOpen,
} from "lucide-react";
import { useStore } from "@/lib/store";
import type { Material, MaterialType } from "@/lib/types";
import { EmptyState, Modal, PageHeader } from "@/components/ui/kit";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/courses/$courseId/materials")({
  component: Materials,
});

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

function detectType(name: string): MaterialType {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") return "pdf";
  if (["ppt", "pptx"].includes(ext)) return "ppt";
  if (["mp4", "mov", "webm"].includes(ext)) return "video";
  return "doc";
}

function Materials() {
  const { courseId } = Route.useParams();
  const { materials, addMaterials, updateMaterial } = useStore();
  const list = materials.filter((m) => m.courseId === courseId);
  const [open, setOpen] = useState(false);
  const [drag, setDrag] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);

  const handleFiles = (files: FileList | null) => {
    if (!files?.length) return;
    const items: Material[] = Array.from(files).map((f, i) => ({
      id: `up-${Date.now()}-${i}`,
      courseId,
      name: f.name,
      type: detectType(f.name),
      kind: "Upload",
      meta: `${(f.size / 1024 / 1024).toFixed(1)} MB`,
      added: "Just now",
      status: "processing",
    }));
    addMaterials(items);
    setRecent((r) => [...items.map((m) => m.id), ...r]);
    // Mock processing — replace with backend job status polling.
    items.forEach((m, i) =>
      setTimeout(() => updateMaterial(m.id, { status: "ready" }), 2200 + i * 900),
    );
  };

  return (
    <div>
      <PageHeader
        title="Course Materials"
        subtitle="Slides, textbooks, notes and lecture recordings."
        action={
          <button className="btn btn-primary" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" />
            Add Files
          </button>
        }
      />

      {list.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title="No materials yet"
          body="Upload slides, PDFs or lecture videos to start generating notes and quizzes."
          action={
            <button className="btn btn-primary" onClick={() => setOpen(true)}>
              Add Materials
            </button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((m, i) => {
            const Icon = typeIcon[m.type];
            return (
              <div
                key={m.id}
                className="card lift fade-up flex flex-col p-5"
                style={{ animationDelay: `${i * 40}ms` }}
              >
                <div className="flex items-start justify-between gap-3">
                  <span
                    className={cn(
                      "flex h-10 w-10 items-center justify-center rounded-xl border bg-surface-2",
                      typeColor[m.type],
                    )}
                  >
                    <Icon className="h-5 w-5" />
                  </span>
                  <StatusChip status={m.status} />
                </div>
                <div className="mt-4 truncate font-medium" title={m.name}>
                  {m.name}
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  {m.kind} · {m.meta}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{m.added}</div>
                <button
                  className="btn btn-ghost mt-5 self-start"
                  disabled={m.status === "processing"}
                >
                  Open
                </button>
              </div>
            );
          })}
        </div>
      )}

      <Modal
        open={open}
        onOpenChange={setOpen}
        title="Add course materials"
        description="Files are processed so your tutor, notes and quizzes can cite them."
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
            handleFiles(e.dataTransfer.files);
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
            <UploadCloud className="h-7 w-7" />
          </span>
          <p className="mt-4 font-medium">Drag & drop your course materials here</p>
          <p className="my-3 text-xs text-muted-foreground">or</p>
          <button className="btn btn-primary" onClick={() => input.current?.click()}>
            Browse Files
          </button>
          <input
            ref={input}
            type="file"
            multiple
            className="hidden"
            accept=".pdf,.ppt,.pptx,.doc,.docx,.mp4"
            onChange={(e) => handleFiles(e.target.files)}
          />
          <p className="mt-4 font-mono text-xs text-muted-foreground">PDF · PPTX · DOCX · MP4</p>
        </div>
        {recent.length > 0 && (
          <div className="mt-5 space-y-2">
            {recent.map((id) => {
              const m = materials.find((x) => x.id === id);
              if (!m) return null;
              const Icon = typeIcon[m.type];
              return (
                <div
                  key={id}
                  className="flex items-center gap-3 rounded-xl border bg-background px-3 py-2.5"
                >
                  <Icon className={cn("h-4 w-4", typeColor[m.type])} />
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
    </div>
  );
}
