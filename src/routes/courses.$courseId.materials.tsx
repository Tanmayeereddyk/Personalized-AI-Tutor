import { createFileRoute } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { FileText, Presentation, Video, File, Plus, UploadCloud, CheckCircle2, Loader2, AlertCircle, FolderOpen, Trash2, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useDeleteMaterial, useMaterials, useUploadMaterials } from "@/lib/queries";
import type { Material, MaterialType } from "@/lib/types";
import { EmptyState, Modal, PageHeader } from "@/components/ui/kit";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/courses/$courseId/materials")({
  component: Materials,
});

const typeIcon: Record<MaterialType, typeof FileText> = { pdf: FileText, ppt: Presentation, video: Video, doc: File };
const typeColor: Record<MaterialType, string> = { pdf: "text-course-rose", ppt: "text-course-amber", video: "text-course-violet", doc: "text-course-sky" };

export function StatusChip({ status }: { status: Material["status"] }) {
  if (status === "ready") return <span className="chip text-success"><CheckCircle2 className="h-3 w-3" />Ready</span>;
  if (status === "processing") return <span className="chip text-primary"><Loader2 className="h-3 w-3 animate-spin" />Processing…</span>;
  return <span className="chip text-warning"><AlertCircle className="h-3 w-3" />Needs attention</span>;
}

function Materials() {
  const { courseId } = Route.useParams();
  const materials = useMaterials(courseId);
  const upload = useUploadMaterials(courseId);
  const remove = useDeleteMaterial(courseId);
  const list = materials.data ?? [];
  const [open, setOpen] = useState(false);
  const [drag, setDrag] = useState(false);
  const [recent, setRecent] = useState<string[]>([]);
  const input = useRef<HTMLInputElement>(null);

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    try {
      const saved = await upload.mutateAsync(Array.from(files));
      setRecent((r) => [...saved.map((m) => m.id), ...r]);
      toast.success(`${saved.length} file${saved.length === 1 ? "" : "s"} uploaded.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      if (input.current) input.current.value = "";
    }
  };

  const openMaterial = async (id: string) => {
    try {
      const url = await api.materials.url(id);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not open the file.");
    }
  };

  const removeMaterial = async (id: string) => {
    try {
      await remove.mutateAsync(id);
      setRecent((r) => r.filter((x) => x !== id));
      toast.success("Material removed.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove the material.");
    }
  };

  return (
    <div>
      <PageHeader title="Course Materials" subtitle="Slides, textbooks, notes and lecture recordings."
        action={<button className="btn btn-primary" onClick={() => setOpen(true)}><Plus className="h-4 w-4" />Add Files</button>} />

      {materials.isLoading ? (
        <div className="card px-6 py-16 text-center text-sm text-muted-foreground">Loading materials…</div>
      ) : materials.isError ? (
        <div className="card px-6 py-16 text-center">
          <p className="font-medium">Couldn't load materials</p>
          <p className="mt-1 text-sm text-muted-foreground">{(materials.error as Error).message}</p>
          <button className="btn btn-primary mt-5" onClick={() => materials.refetch()}>Try again</button>
        </div>
      ) : list.length === 0 ? (
        <EmptyState icon={FolderOpen} title="No materials yet" body="Upload slides, PDFs or lecture videos to keep everything for this course in one place."
          action={<button className="btn btn-primary" onClick={() => setOpen(true)}>Add Materials</button>} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((m, i) => {
            const Icon = typeIcon[m.type];
            return (
              <div key={m.id} className="card lift fade-up flex flex-col p-5" style={{ animationDelay: `${i * 40}ms` }}>
                <div className="flex items-start justify-between gap-3">
                  <span className={cn("flex h-10 w-10 items-center justify-center rounded-xl border bg-surface-2", typeColor[m.type])}><Icon className="h-5 w-5" /></span>
                  <StatusChip status={m.status} />
                </div>
                <div className="mt-4 truncate font-medium" title={m.name}>{m.name}</div>
                <div className="mt-1 text-sm text-muted-foreground">{m.kind} · {m.meta}</div>
                <div className="mt-1 text-xs text-muted-foreground">{m.added}</div>
                <div className="mt-5 flex items-center gap-1">
                  <button className="btn btn-ghost self-start" disabled={m.status === "processing"} onClick={() => openMaterial(m.id)}>
                    <ExternalLink className="h-4 w-4" />Open
                  </button>
                  <button className="btn btn-ghost self-start text-destructive" onClick={() => removeMaterial(m.id)} disabled={remove.isPending}>
                    <Trash2 className="h-4 w-4" />Remove
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Modal open={open} onOpenChange={setOpen} title="Add course materials" description="Files are stored privately in your own account." wide>
        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); void handleFiles(e.dataTransfer.files); }}
          className={cn("flex flex-col items-center rounded-2xl border-2 border-dashed px-6 py-12 text-center transition",
            drag ? "border-primary bg-primary/5" : "border-foreground/15")}
        >
          <span className={cn("flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary text-primary transition", drag && "scale-110")}>
            {upload.isPending ? <Loader2 className="h-7 w-7 animate-spin" /> : <UploadCloud className="h-7 w-7" />}
          </span>
          <p className="mt-4 font-medium">{upload.isPending ? "Uploading…" : "Drag & drop your course materials here"}</p>
          <p className="my-3 text-xs text-muted-foreground">or</p>
          <button className="btn btn-primary" onClick={() => input.current?.click()} disabled={upload.isPending}>Browse Files</button>
          <input ref={input} type="file" multiple className="hidden" accept=".pdf,.ppt,.pptx,.doc,.docx,.mp4" onChange={(e) => void handleFiles(e.target.files)} />
          <p className="mt-4 font-mono text-xs text-muted-foreground">PDF · PPTX · DOCX · MP4</p>
        </div>
        {recent.length > 0 && (
          <div className="mt-5 space-y-2">
            {recent.map((id) => {
              const m = list.find((x) => x.id === id);
              if (!m) return null;
              const Icon = typeIcon[m.type];
              return (
                <div key={id} className="flex items-center gap-3 rounded-xl border bg-background px-3 py-2.5">
                  <Icon className={cn("h-4 w-4", typeColor[m.type])} />
                  <span className="flex-1 truncate text-sm">{m.name}</span>
                  <StatusChip status={m.status} />
                </div>
              );
            })}
          </div>
        )}
        <div className="mt-6 flex justify-end"><button className="btn btn-ghost" onClick={() => setOpen(false)}>Done</button></div>
      </Modal>
    </div>
  );
}
