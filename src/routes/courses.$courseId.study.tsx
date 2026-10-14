import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import {
  ArrowLeft,
  BookOpen,
  Download,
  ExternalLink,
  FileWarning,
  FolderOpen,
  GripVertical,
  Layers,
  Loader2,
  Maximize2,
  Minimize2,
  NotebookPen,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useExtractionStatus, useGenerateNotes, useMaterials, useTranscript } from "@/lib/queries";
import { useCourse } from "@/lib/store";
import { useLayout } from "@/lib/layout";
import { FullScreenPage } from "@/components/layout/FullScreenPage";
import { EmptyState } from "@/components/ui/kit";
import { AudioTranscript } from "@/components/materials/AudioTranscript";
import { PreviewPane } from "@/components/materials/PreviewPane";
import { CourseTutor } from "@/components/tutor/CourseTutor";
import { NotesPanel } from "@/components/tutor/NotesPanel";
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

/**
 * Layouts the study workspace can show. The user's choice is remembered for
 * the session (and across reloads) so switching material never resets it.
 *
 * - ``material-notes`` — read the source next to your notes.
 * - ``notes-tutor``    — study notes beside the grounded tutor.
 * - ``notes``          — notes only, full width.
 * - ``material-tutor`` — read the source beside the tutor.
 */
type StudyMode = "material-notes" | "notes-tutor" | "notes" | "material-tutor";

const MODE_KEY = "studyai.study.mode";
const LAYOUT_PREFIX = "studyai.study.layout";

const MATERIAL_MIN = 320; // px
const NOTES_MIN = 300; // px
const TUTOR_MIN = 320; // px

const MODE_OPTIONS: ReadonlyArray<{
  value: StudyMode;
  label: string;
  short: string;
  icon: typeof BookOpen;
}> = [
  { value: "material-notes", label: "Material + Notes", short: "Material", icon: BookOpen },
  { value: "notes-tutor", label: "Notes + Tutor", short: "Notes + Tutor", icon: Sparkles },
  { value: "notes", label: "Notes only", short: "Notes", icon: NotebookPen },
  { value: "material-tutor", label: "Material + Tutor", short: "Material + Tutor", icon: Layers },
];

type Layout = { [panelId: string]: number };

function isStudyMode(value: string | null): value is StudyMode {
  return value !== null && MODE_OPTIONS.some((option) => option.value === value);
}

function readMode(): StudyMode {
  if (typeof window === "undefined") return "material-notes";
  try {
    const stored = window.localStorage.getItem(MODE_KEY);
    return isStudyMode(stored) ? stored : "material-notes";
  } catch {
    return "material-notes";
  }
}

function layoutKey(mode: StudyMode): string {
  return `${LAYOUT_PREFIX}.${mode}`;
}

/** Read a previously dragged layout for one mode, if it is still valid. */
function readLayout(mode: StudyMode): Layout | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(layoutKey(mode));
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return undefined;
    const entries = Object.entries(parsed as Record<string, unknown>).filter(
      ([, value]) => typeof value === "number" && Number.isFinite(value),
    );
    return entries.length > 0 ? (Object.fromEntries(entries) as Layout) : undefined;
  } catch {
    return undefined;
  }
}

function saveLayout(mode: StudyMode, layout: Layout): void {
  try {
    window.localStorage.setItem(layoutKey(mode), JSON.stringify(layout));
  } catch {
    /* ignore storage failures */
  }
}

export function StudyWorkspace() {
  const { courseId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate();
  const course = useCourse(courseId);
  const materials = useMaterials(courseId);
  const list = materials.data ?? [];

  const requested = search["material"];
  const selected =
    requested && list.some((m) => m.id === requested)
      ? (list.find((m) => m.id === requested) ?? undefined)
      : undefined;
  const fallback = selected ?? list[0];

  const [url, setUrl] = useState<string | null>(null);
  const [urlState, setUrlState] = useState<UrlState>("idle");
  const [session, setSession] = useState(0);
  const [mode, setMode] = useState<StudyMode>(readMode);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);

  const { focus, toggleFocus, setFocus } = useLayout();
  const generate = useGenerateNotes(courseId);

  // Leaving the page always closes full screen, so its state never leaks to
  // another route.
  useEffect(() => () => setFocus(false), [setFocus]);

  useEffect(() => {
    try {
      window.localStorage.setItem(MODE_KEY, mode);
    } catch {
      /* ignore storage failures */
    }
  }, [mode]);

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

  const switchMaterial = useCallback(
    (id: string) => {
      void navigate({
        to: "/courses/$courseId/study",
        params: { courseId },
        search: { material: id },
      });
    },
    [courseId, navigate],
  );

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

  /** Generate notes for the material currently open, then reveal the list. */
  const generateNotes = async () => {
    if (!fallback) return;
    try {
      await generate.mutateAsync({ materialId: fallback.id });
      setSelectedNoteId(null);
      toast.success("Notes generated");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not generate notes.");
    }
  };

  /** The study workspace, shared by the inline and full screen renders. */
  const workspace = fallback ? (
    <WorkspaceLayout
      material={fallback}
      course={course}
      courseId={courseId}
      session={session}
      url={url}
      urlState={urlState}
      onRetry={refreshUrl}
      onDownload={download}
      mode={mode}
      focus={focus}
      selectedNoteId={selectedNoteId}
      onSelectNote={setSelectedNoteId}
      onBack={() => setSelectedNoteId(null)}
      onGenerateNotes={generateNotes}
      generating={generate.isPending}
      onOpenMaterial={switchMaterial}
    />
  ) : null;

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
        <div className="card px-6 py-16 text-center text-sm text-muted-foreground">
          Loading materials…
        </div>
      ) : materials.isError ? (
        <div className="card px-6 py-16 text-center">
          <p className="font-medium">Couldn't load materials</p>
          <p className="mt-1 text-sm text-muted-foreground">{(materials.error as Error).message}</p>
          <button className="btn btn-primary mt-5" onClick={() => void materials.refetch()}>
            Try again
          </button>
        </div>
      ) : list.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title="No materials to study yet"
          body="Upload PDFs, slides or lecture recordings and open them right here in a split workspace."
          action={
            <Link
              to="/courses/$courseId/materials"
              params={{ courseId }}
              className="btn btn-primary"
            >
              <BookOpen className="h-4 w-4" />
              Browse Materials
            </Link>
          }
        />
      ) : requested && !selected ? (
        <div className="card px-6 py-16 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15 text-primary">
            <FileWarning className="h-6 w-6" />
          </span>
          <p className="mt-4 font-medium">This file isn't in this course anymore</p>
          <p className="mt-1 text-sm text-muted-foreground">
            It may have been removed, or the link is stale.
          </p>
          <button
            className="btn btn-primary mt-5"
            onClick={() => switchMaterial(fallback?.id ?? "")}
          >
            Open first material
          </button>
        </div>
      ) : fallback ? (
        focus ? (
          <FullScreenPage title={fallback.name} onClose={toggleFocus}>
            <ViewModeBar
              mode={mode}
              onChange={setMode}
              focus={focus}
              onToggleFocus={toggleFocus}
              showFocusControl={false}
            />
            {workspace}
          </FullScreenPage>
        ) : (
          <>
            <ViewModeBar mode={mode} onChange={setMode} focus={focus} onToggleFocus={toggleFocus} />
            {workspace}
          </>
        )
      ) : null}
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
    <div className="mb-3 flex flex-wrap items-center gap-3">
      <Link
        to="/courses/$courseId/materials"
        params={{ courseId }}
        className="btn btn-ghost px-2.5"
      >
        <ArrowLeft className="h-4 w-4" />
        Materials
      </Link>
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
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))
        )}
      </select>
      {course ? <span className="chip font-mono">{course.code}</span> : null}
      <div className="ml-auto flex flex-wrap items-center gap-2">
        <button className="btn btn-ghost" onClick={onRefresh}>
          <RefreshCw className={cn("h-4 w-4", urlState === "loading" && "animate-spin")} />
          Refresh link
        </button>
        <button className="btn btn-ghost" onClick={onDownload} disabled={urlState !== "ready"}>
          <Download className="h-4 w-4" />
          Download
        </button>
        {selected && !canPreview(selected) && urlState === "ready" && url ? (
          <button
            className="btn btn-primary"
            onClick={() => window.open(url, "_blank", "noopener")}
          >
            <ExternalLink className="h-4 w-4" />
            Open elsewhere
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Visible control for the four workspace layouts. */
function ViewModeBar({
  mode,
  onChange,
  focus,
  onToggleFocus,
  showFocusControl = true,
}: {
  mode: StudyMode;
  onChange: (mode: StudyMode) => void;
  focus: boolean;
  onToggleFocus: () => void;
  showFocusControl?: boolean;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <span className="hidden text-xs font-medium uppercase tracking-wider text-muted-foreground sm:inline">
        Layout
      </span>
      <div
        className="inline-flex flex-wrap rounded-xl border p-0.5"
        role="group"
        aria-label="Study layout"
      >
        {MODE_OPTIONS.map(({ value, label, short, icon: Icon }) => {
          const active = mode === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => onChange(value)}
              aria-pressed={active}
              title={label}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
                active
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{short}</span>
            </button>
          );
        })}
      </div>

      {showFocusControl && (
        <button
          type="button"
          onClick={onToggleFocus}
          aria-pressed={focus}
          aria-label={focus ? "Exit full screen" : "Full screen"}
          title={focus ? "Exit full screen" : "Expand the workspace to the full screen"}
          className={cn(
            "btn btn-ghost ml-auto px-2.5 py-1.5 text-xs",
            focus ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {focus ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          <span className="hidden sm:inline">{focus ? "Exit full screen" : "Full screen"}</span>
        </button>
      )}
    </div>
  );
}

function PanelDivider({ label }: { label: string }) {
  return (
    <Separator
      aria-label={label}
      className="group relative z-10 flex w-2 shrink-0 cursor-col-resize items-center justify-center bg-transparent focus-visible:outline-none"
    >
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border transition-colors group-hover:bg-primary/70 group-data-[separator=active]:bg-primary group-focus-visible:bg-primary"
      />
      <span
        aria-hidden
        className={cn(
          "pointer-events-none relative flex h-9 w-4 items-center justify-center rounded-full border bg-surface-2 text-muted-foreground shadow-sm transition-opacity",
          "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 group-data-[separator=active]:opacity-100",
        )}
      >
        <GripVertical className="h-4 w-4" />
      </span>
    </Separator>
  );
}

/** Two independently scrolling panels split by a draggable divider. */
function Split({
  mode,
  primaryId,
  secondaryId,
  primaryMin,
  secondaryMin,
  defaultPrimary,
  heightClass,
  primary,
  secondary,
}: {
  mode: StudyMode;
  primaryId: string;
  secondaryId: string;
  primaryMin: number;
  secondaryMin: number;
  defaultPrimary: number;
  heightClass: string;
  primary: ReactNode;
  secondary: ReactNode;
}) {
  const initial = useMemo<Layout>(() => {
    const stored = readLayout(mode);
    if (
      stored &&
      typeof stored[primaryId] === "number" &&
      typeof stored[secondaryId] === "number"
    ) {
      return stored;
    }
    return { [primaryId]: defaultPrimary, [secondaryId]: 100 - defaultPrimary };
  }, [mode, primaryId, secondaryId, defaultPrimary]);

  return (
    <Group
      key={mode}
      id={`study-${mode}`}
      orientation="horizontal"
      className={heightClass}
      defaultLayout={initial}
      onLayoutChanged={(layout) => saveLayout(mode, layout)}
    >
      <Panel id={primaryId} minSize={primaryMin} className="min-w-0 overflow-hidden">
        <div className="h-full min-h-0">{primary}</div>
      </Panel>
      <PanelDivider label={`Resize ${primaryId} and ${secondaryId} panels`} />
      <Panel id={secondaryId} minSize={secondaryMin} className="min-w-0 overflow-hidden">
        <div className="h-full min-h-0">{secondary}</div>
      </Panel>
    </Group>
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
  mode,
  focus,
  selectedNoteId,
  onSelectNote,
  onBack,
  onGenerateNotes,
  generating,
  onOpenMaterial,
}: {
  material: Material;
  course?: Course | undefined;
  courseId: string;
  session: number;
  url: string | null;
  urlState: UrlState;
  onRetry: () => void;
  onDownload: () => void;
  mode: StudyMode;
  focus: boolean;
  selectedNoteId: string | null;
  onSelectNote: (id: string) => void;
  onBack: () => void;
  onGenerateNotes: () => void;
  generating: boolean;
  onOpenMaterial: (id: string) => void;
}) {
  const isDesktop = useMediaQuery("(min-width: 900px)");
  // Full screen fills the overlay; otherwise the workspace is a viewport slice.
  const heightClass = focus ? "min-h-0 flex-1" : "h-[calc(100dvh-22rem)] min-h-[560px]";

  const materialPanel = (
    <Reader
      material={material}
      session={session}
      url={url}
      urlState={urlState}
      onRetry={onRetry}
      onDownload={onDownload}
    />
  );

  const notesPanel = (
    <div className="card h-full min-h-0 overflow-hidden">
      <NotesPanel
        courseId={courseId}
        selectedNoteId={selectedNoteId}
        onSelectNote={onSelectNote}
        onBack={onBack}
        onGenerate={onGenerateNotes}
        generating={generating}
        onOpenMaterial={onOpenMaterial}
      />
    </div>
  );

  const tutorPanel = (
    <div className="card flex h-full min-h-0 flex-col overflow-hidden">
      <CourseTutor courseId={courseId} courseCode={course?.code ?? "Course"} />
    </div>
  );

  if (!isDesktop) {
    // Compact stacked layout: every panel is still reachable and scrolls on
    // its own; the choice of layout is preserved like on desktop.
    if (mode === "notes") {
      return <div className="h-[70vh] min-h-[420px]">{notesPanel}</div>;
    }
    const first =
      mode === "material-tutor"
        ? materialPanel
        : mode === "notes-tutor"
          ? notesPanel
          : materialPanel;
    const second = mode === "notes-tutor" || mode === "material-tutor" ? tutorPanel : notesPanel;
    return (
      <div className="space-y-4">
        <div className="h-[55vh] min-h-[380px]">{first}</div>
        <div className="h-[60vh] min-h-[420px]">{second}</div>
      </div>
    );
  }

  if (mode === "notes") {
    return <div className={heightClass}>{notesPanel}</div>;
  }

  if (mode === "notes-tutor") {
    return (
      <Split
        mode={mode}
        primaryId="notes"
        secondaryId="tutor"
        primaryMin={NOTES_MIN}
        secondaryMin={TUTOR_MIN}
        defaultPrimary={60}
        heightClass={heightClass}
        primary={notesPanel}
        secondary={tutorPanel}
      />
    );
  }

  if (mode === "material-tutor") {
    return (
      <Split
        mode={mode}
        primaryId="material"
        secondaryId="tutor"
        primaryMin={MATERIAL_MIN}
        secondaryMin={TUTOR_MIN}
        defaultPrimary={60}
        heightClass={heightClass}
        primary={materialPanel}
        secondary={tutorPanel}
      />
    );
  }

  return (
    <Split
      mode="material-notes"
      primaryId="material"
      secondaryId="notes"
      primaryMin={MATERIAL_MIN}
      secondaryMin={NOTES_MIN}
      defaultPrimary={58}
      heightClass={heightClass}
      primary={materialPanel}
      secondary={notesPanel}
    />
  );
}

function canPreview(material: Material): boolean {
  if (material.type === "pdf") return true;
  if (material.type === "ppt") return true;
  if (material.type === "doc") return true;
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
        <span className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Opening “{material.name}”…
        </span>
      </div>
    );
  }

  if (urlState === "error" || !url) {
    return (
      <div className="card flex h-full flex-col items-center justify-center px-6 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15 text-primary">
          <FileWarning className="h-6 w-6" />
        </span>
        <p className="mt-4 font-medium">Couldn't open this file</p>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          The temporary access link couldn't be created for “{material.name}”. This is often a
          storage syncing delay — try again.
        </p>
        <button className="btn btn-primary mt-5" onClick={onRetry}>
          Try again
        </button>
      </div>
    );
  }

  const previewable = canPreview(material);
  if (!previewable) {
    return (
      <div className="card flex h-full flex-col items-center justify-center px-6 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15 text-primary">
          <FileWarning className="h-6 w-6" />
        </span>
        <p className="mt-4 font-medium">No inline preview for this file type</p>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          Slides and documents from Microsoft Office can't be rendered inline yet. Download the file
          or open it in your usual app instead.
        </p>
        <div className="mt-5 flex gap-2">
          <button className="btn btn-primary" onClick={onDownload}>
            <Download className="h-4 w-4" />
            Download
          </button>
          <a href={url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost">
            <ExternalLink className="h-4 w-4" />
            Open in new tab
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="card flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
        <span className="truncate text-sm font-medium">{material.name}</span>
        <span className="shrink-0 text-xs text-muted-foreground">Private · link expires</span>
      </div>
      <div className="flex min-h-0 flex-1 overflow-auto bg-surface-2">
        {material.type === "pdf" ? (
          <iframe key={key} src={url} title={material.name} className="h-full w-full" />
        ) : material.type === "ppt" || material.type === "doc" ? (
          <PreviewPane material={material} />
        ) : material.type === "video" ? (
          <VideoReader material={material} session={session} url={url} />
        ) : (
          <img
            key={key}
            src={url}
            alt={material.name}
            className="m-auto max-h-full max-w-full object-contain"
          />
        )}
      </div>
    </div>
  );
}

function VideoReader({
  material,
  session,
  url,
}: {
  material: Material;
  session: number;
  url: string;
}) {
  const playerRef = useRef<HTMLVideoElement>(null);
  const status = useExtractionStatus(material.id);
  const transcript = useTranscript(material.id);

  const seek = (seconds: number) => {
    const player = playerRef.current;
    if (!player) return;
    player.currentTime = seconds;
    void player.play();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-[3] items-center justify-center bg-black">
        <video
          ref={playerRef}
          key={`${material.id}:${session}`}
          controls
          src={url}
          className="h-full max-h-full w-full"
        />
      </div>
      <div className="min-h-0 flex-[2] overflow-auto border-t bg-surface-2 p-3">
        <AudioTranscript
          segments={transcript.data ?? []}
          status={status.data?.status ?? material.status}
          stage={status.data?.stage}
          warnings={status.data?.warnings ?? []}
          loading={transcript.isLoading}
          error={transcript.isError}
          onSeek={seek}
        />
      </div>
    </div>
  );
}
