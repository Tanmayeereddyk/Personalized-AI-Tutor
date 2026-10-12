import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import * as Tabs from "@radix-ui/react-tabs";
import { Corner as ScrollAreaCorner, Root as ScrollAreaRoot, Scrollbar as ScrollAreaScrollbar, Thumb as ScrollAreaThumb, Viewport as ScrollAreaViewport } from "@radix-ui/react-scroll-area";
import { ArrowLeft, BookOpen, Download, ExternalLink, FileWarning, FolderOpen, Loader2, NotebookPen, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useMaterials, useNotes } from "@/lib/queries";
import { useCourse } from "@/lib/store";
import { EmptyState } from "@/components/ui/kit";
import { TutorUnavailable } from "@/components/practice/TutorUnavailable";
import { useMediaQuery } from "@/lib/use-media-query";
import type { Course, Material } from "@/lib/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/courses/$courseId/study")({
  validateSearch: (search: Record<string, unknown>) => ({
    material: typeof search["material"] === "string" ? search["material"] : undefined,
  }),
  component: StudyWorkspace,
});

type UrlState = "idle" | "loading" | "ready" | "error";

function StudyWorkspace() {
  const { courseId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const course = useCourse(courseId);
  const materials = useMaterials(courseId);
  const list = materials.data ?? [];

  const requested = search["material"];
  const selected =
    requested && list.some((m) => m.id === requested) ? (list.find((m) => m.id === requested) ?? undefined) : undefined;
  const fallback = selected ?? list[0];

  const [url, setUrl] = useState<string | null>(null);
  const [urlState, setUrlState] = useState<UrlState>("idle");
  const [session, setSession] = useState(0);

  const refreshUrl = useCallback(() => {
    setSession((s) => s + 1);
  }, []);

  useEffect(() => {
    if (!fallback) return;
    let cancelled = false;
    setUrlState("loading");
    setUrl(null);
    api.materials
      .url(fallback.id)
      .then((value) => {
        if (cancelled) return;
        setUrl(value);
        setUrlState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setUrlState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [fallback, session]);

  const switchMaterial = (id: string) => {
    void navigate({
      to: "/courses/$courseId/study",
      params: { courseId },
      search: { material: id },
    });
  };

  const download = async () => {
    if (!fallback || urlState !== "ready" || !url) return;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = fallback.name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      window.open(url, "_blank", "noopener,noreferrer");
    }
  };

  return (
    <div>
      <Toolbar
        course={course}
        options={list}
        selected={fallback}
        url={url}
        urlState={urlState}
        onSelect={switchMaterial}
        onRefresh={refreshUrl}
        onDownload={download}
      />

      {materials.isLoading ? (
        <div className="card px-6 py-16 text-center text-sm text-muted-foreground">Loading materials…</div>
      ) : materials.isError ? (
        <div className="card px-6 py-16 text-center">
          <p className="font-medium">Couldn't load materials</p>
          <p className="mt-1 text-sm text-muted-foreground">{(materials.error as Error).message}</p>
          <button className="btn btn-primary mt-5" onClick={() => void materials.refetch()}>Try again</button>
        </div>
      ) : list.length === 0 ? (
        <EmptyState icon={FolderOpen} title="No materials to study yet"
          body="Upload PDFs, slides or lecture recordings and open them right here in a split workspace."
          action={<Link to="/courses/$courseId/materials" params={{ courseId }} className="btn btn-primary"><BookOpen className="h-4 w-4" />Browse Materials</Link>} />
      ) : requested && !selected ? (
        <div className="card px-6 py-16 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15 text-primary"><FileWarning className="h-6 w-6" /></span>
          <p className="mt-4 font-medium">This file isn't in this course anymore</p>
          <p className="mt-1 text-sm text-muted-foreground">It may have been removed, or the link is stale.</p>
          <button className="btn btn-primary mt-5" onClick={() => switchMaterial(fallback?.id ?? "")}>Open first material</button>
        </div>
      ) : (
        fallback && (
          <WorkspaceLayout
            material={fallback}
            course={course}
            courseId={courseId}
            session={session}
            url={url}
            urlState={urlState}
            onRetry={refreshUrl}
            onDownload={download}
          />
        )
      )}
    </div>
  );
}

function Toolbar({
  course,
  options,
  selected,
  url,
  urlState,
  onSelect,
  onRefresh,
  onDownload,
}: {
  course?: Course | undefined;
  options: Material[];
  selected?: Material | undefined;
  url: string | null;
  urlState: UrlState;
  onSelect: (id: string) => void;
  onRefresh: () => void;
  onDownload: () => void;
}) {
  const { courseId } = Route.useParams();
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3">
      <Link to="/courses/$courseId/materials" params={{ courseId }} className="btn btn-ghost px-2.5"><ArrowLeft className="h-4 w-4" />Materials</Link>
      <select
        className="field max-w-60"
        value={selected?.id ?? ""}
        onChange={(e) => onSelect(e.target.value)}
        disabled={options.length === 0}
        aria-label="Study file"
      >
        {options.length === 0 ? (
          <option value="">Select a file…</option>
        ) : (
          options.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))
        )}
      </select>
      {course ? <span className="chip text-muted-foreground">{course.code}</span> : null}
      {selected ? <h1 className="max-w-72 truncate text-sm font-medium sm:max-w-none">{selected.name}</h1> : null}
      <div className="ml-auto flex items-center gap-2">
        <button className="btn btn-ghost" onClick={onRefresh} disabled={!selected || urlState === "loading"} title="Regenerate the temporary access link">
          <RefreshCw className={cn("h-4 w-4", urlState === "loading" && "animate-spin")} />Refresh link
        </button>
        <button className="btn btn-ghost" onClick={onDownload} disabled={!selected || urlState !== "ready"}><Download className="h-4 w-4" />Download</button>
        {selected && !canPreview(selected) && urlState === "ready" && url ? (
          <button className="btn btn-primary" onClick={() => window.open(url, "_blank", "noopener")}><ExternalLink className="h-4 w-4" />Open elsewhere</button>
        ) : null}
      </div>
    </div>
  );
}

function WorkspaceLayout({
  material,
  course,
  courseId,
  session,
  url,
  urlState,
  onRetry,
  onDownload,
}: {
  material: Material;
  course?: Course | undefined;
  courseId: string;
  session: number;
  url: string | null;
  urlState: UrlState;
  onRetry: () => void;
  onDownload: () => void;
}) {
  const isDesktop = useMediaQuery("(min-width: 900px)");

  if (isDesktop) {
    return (
      <Group orientation="horizontal" className="h-[calc(100vh-21rem)] min-h-[560px]">
        <Panel defaultSize="65" minSize="40">
          <Reader material={material} session={session} url={url} urlState={urlState} onRetry={onRetry} onDownload={onDownload} />
        </Panel>
        <Separator className="w-1.5 bg-transparent transition-colors data-[separator=hover]:bg-border data-[separator=focus]:bg-border data-[separator=active]:bg-primary" />
        <Panel defaultSize="35" minSize="24">
          <SidePanel course={course} courseId={courseId} />
        </Panel>
      </Group>
    );
  }

  return (
    <div className="space-y-4">
      <div className="h-[55vh] min-h-[380px]"><Reader material={material} session={session} url={url} urlState={urlState} onRetry={onRetry} onDownload={onDownload} /></div>
      <div className="h-[48vh] min-h-[380px]"><SidePanel course={course} courseId={courseId} /></div>
    </div>
  );
}

function canPreview(material: Material): boolean {
  if (material.type === "pdf") return true;
  if (material.mimeType?.startsWith("image/")) return true;
  if (material.type === "video") return true;
  return false;
}

function Reader({
  material,
  session,
  url,
  urlState,
  onRetry,
  onDownload,
}: {
  material: Material;
  session: number;
  url: string | null;
  urlState: UrlState;
  onRetry: () => void;
  onDownload: () => void;
}) {
  const key = `${material.id}:${session}`;

  if (urlState === "loading") {
    return (
      <div className="card flex h-full items-center justify-center">
        <span className="flex items-center gap-3 text-sm text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" />Opening “{material.name}”…</span>
      </div>
    );
  }

  if (urlState === "error" || !url) {
    return (
      <div className="card flex h-full flex-col items-center justify-center px-6 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15 text-primary"><FileWarning className="h-6 w-6" /></span>
        <p className="mt-4 font-medium">Couldn't open this file</p>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">The temporary access link couldn't be created for “{material.name}”. This is often a storage syncing delay — try again.</p>
        <button className="btn btn-primary mt-5" onClick={onRetry}>Try again</button>
      </div>
    );
  }

  const previewable = canPreview(material);
  if (!previewable) {
    return (
      <div className="card flex h-full flex-col items-center justify-center px-6 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15 text-primary"><FileWarning className="h-6 w-6" /></span>
        <p className="mt-4 font-medium">No inline preview for this file type</p>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">Slides and documents from Microsoft Office can't be rendered inline yet. Download the file or open it in your usual app instead.</p>
        <div className="mt-5 flex gap-2">
          <button className="btn btn-primary" onClick={onDownload}><Download className="h-4 w-4" />Download</button>
          <a href={url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost"><ExternalLink className="h-4 w-4" />Open in new tab</a>
        </div>
      </div>
    );
  }

  const isImage = material.mimeType?.startsWith("image/") ?? false;
  return (
    <div className="card flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
        <span className="truncate text-sm font-medium">{material.name}</span>
        <span className="shrink-0 text-xs text-muted-foreground">Private · link expires</span>
      </div>
      <div className="flex min-h-0 flex-1 overflow-auto bg-surface-2">
        {material.type === "pdf" ? (
          <iframe key={key} src={url} title={material.name} className="h-full w-full" />
        ) : material.type === "video" ? (
          <video key={key} controls src={url} className="mx-auto h-full max-w-full" />
        ) : isImage ? (
          <img key={key} src={url} alt={material.name} className="mx-auto h-full max-w-full object-contain p-4" />
        ) : (
          <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
            <FileWarning className="mr-2 h-5 w-5" />Preview isn't available for “{material.name}”.
          </div>
        )}
      </div>
    </div>
  );
}

function SidePanel({ course, courseId }: { course?: Course | undefined; courseId: string }) {
  const [tab, setTab] = useState<"tutor" | "notes">("tutor");
  return (
    <div className="card flex h-full min-h-0 flex-col overflow-hidden">
      <Tabs.Root value={tab} onValueChange={(v) => setTab(v as "tutor" | "notes")} className="flex h-full min-h-0 flex-col">
        <Tabs.List className="flex shrink-0 border-b">
          <Tabs.Trigger value="tutor" className="relative flex flex-1 items-center justify-center gap-2 px-3 py-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground data-[state=active]:text-foreground">
            <Sparkles className="h-4 w-4" />Tutor
            {tab === "tutor" ? <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-primary" /> : null}
          </Tabs.Trigger>
          <Tabs.Trigger value="notes" className="relative flex flex-1 items-center justify-center gap-2 px-3 py-3 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground data-[state=active]:text-foreground">
            <NotebookPen className="h-4 w-4" />Notes
            {tab === "notes" ? <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-primary" /> : null}
          </Tabs.Trigger>
        </Tabs.List>
        <Tabs.Content value="tutor" forceMount className="min-h-0 flex-1 data-[state=inactive]:hidden">
          <TutorUnavailable courseCode={course?.code} className="h-full" />
        </Tabs.Content>
        <Tabs.Content value="notes" forceMount className="min-h-0 flex-1 data-[state=inactive]:hidden">
          <NotesPanel courseId={courseId} />
        </Tabs.Content>
      </Tabs.Root>
    </div>
  );
}

function NotesPanel({ courseId }: { courseId: string }) {
  const notes = useNotes(courseId);
  const list = notes.data ?? [];

  if (notes.isLoading) {
    return <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Loading notes…</div>;
  }

  if (notes.isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <p className="text-sm font-medium">Couldn't load notes</p>
        <p className="mt-1 text-xs text-muted-foreground">{(notes.error as Error).message}</p>
        <button className="btn btn-primary mt-4" onClick={() => void notes.refetch()}>Try again</button>
      </div>
    );
  }

  if (list.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary text-muted-foreground"><NotebookPen className="h-6 w-6" /></span>
        <p className="mt-4 text-sm font-medium">No notes yet</p>
        <p className="mt-1 max-w-xs text-xs text-muted-foreground">Generated notes will appear here once automatic note generation is available.</p>
      </div>
    );
  }

  return (
    <ScrollAreaRoot className="h-full w-full flex-1">
      <ScrollAreaViewport className="h-full w-full px-5 py-4">
        <div className="space-y-3">
          {list.map((n) => (
            <article key={n.id} className="rounded-xl border bg-background p-4">
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-sm font-medium">{n.title}</h3>
                <span className="shrink-0 text-xs text-muted-foreground">{n.updated}</span>
              </div>
              {n.content ? (
                <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{n.content}</p>
              ) : null}
              {n.topics.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {n.topics.map((t) => (
                    <span key={t} className="chip">{t}</span>
                  ))}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      </ScrollAreaViewport>
      <ScrollAreaScrollbar orientation="vertical" className="flex w-2.5 touch-none select-none p-0.5">
        <ScrollAreaThumb className="relative flex-1 rounded-full bg-foreground/15" />
      </ScrollAreaScrollbar>
      <ScrollAreaCorner />
    </ScrollAreaRoot>
  );
}