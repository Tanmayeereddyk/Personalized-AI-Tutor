import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import {
  BookOpen,
  GripVertical,
  Layers,
  Maximize2,
  Mic,
  Minimize2,
  NotebookPen,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";

import { MaterialViewer } from "@/components/materials/MaterialViewer";
import { FullScreenPage } from "@/components/layout/FullScreenPage";
import { NotesPanel } from "@/components/tutor/NotesPanel";
import { TutorChat } from "@/components/tutor/TutorChat";
import { useTutorChat } from "@/components/tutor/useTutorChat";
import { useLayout } from "@/lib/layout";
import { useTranscript } from "@/lib/queries";
import { useMediaQuery } from "@/lib/use-media-query";
import type { Material } from "@/lib/types";
import { cn } from "@/lib/utils";
import type { StudyView } from "@/lib/study-view";

/**
 * The study surface shown when the user opens a material or saved notes.
 *
 * It is the reusable core of the StudyFetch-style workspace:
 *
 * - a compact view toolbar (Notes / Transcript / View Material / Split Screen)
 *   whose options disable themselves when they don't apply to the content, and
 * - the AI Tutor as a persistent right-side panel by default, collapsible so
 *   the study content can take the full width.
 *
 * The tutor chat state lives here (via `useTutorChat`) so switching between
 * view modes never resets the conversation.
 */

const MATERIAL_MIN = 320; // px
const NOTES_MIN = 300; // px
const TUTOR_MIN = 320; // px
const SURFACE_HEIGHT = "h-[calc(100dvh-22rem)] min-h-[560px]";
// Full screen (focus) fills the overlay instead of a measured viewport slice.
const SURFACE_HEIGHT_FOCUS = "min-h-0 flex-1";

function readStoredLayout(storageKey: string): Record<string, number> | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return undefined;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return undefined;
    const entries = Object.entries(parsed as Record<string, unknown>).filter(
      ([, value]) => typeof value === "number" && Number.isFinite(value),
    );
    return entries.length > 0 ? (Object.fromEntries(entries) as Record<string, number>) : undefined;
  } catch {
    return undefined;
  }
}

interface ViewOption {
  value: StudyView;
  label: string;
  icon: typeof NotebookPen;
  disabled: boolean;
  title: string;
}

function ViewToolbar({
  view,
  onChange,
  options,
  tutorOpen,
  onToggleTutor,
  focus,
  onToggleFocus,
  showFocusControl = true,
}: {
  view: StudyView;
  onChange: (view: StudyView) => void;
  options: ViewOption[];
  tutorOpen: boolean;
  onToggleTutor: () => void;
  focus: boolean;
  onToggleFocus: () => void;
  showFocusControl?: boolean;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <div
        className="inline-flex flex-wrap rounded-xl border p-0.5"
        role="group"
        aria-label="Study view"
      >
        {options.map(({ value, label, icon: Icon, disabled, title }) => {
          const active = view === value;
          return (
            <button
              key={value}
              type="button"
              onClick={() => onChange(value)}
              disabled={disabled}
              aria-pressed={active}
              title={disabled ? title : label}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors",
                "disabled:cursor-not-allowed disabled:opacity-40",
                active
                  ? "bg-secondary text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{label}</span>
            </button>
          );
        })}
      </div>

      <div className="ml-auto flex items-center gap-2">
        {showFocusControl && (
          <button
            type="button"
            onClick={onToggleFocus}
            aria-pressed={focus}
            aria-label={focus ? "Exit full screen" : "Full screen"}
            title={focus ? "Exit full screen" : "Expand the workspace to the full screen"}
            className={cn(
              "btn btn-ghost px-2.5 py-1.5 text-xs",
              focus ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {focus ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            <span className="hidden sm:inline">{focus ? "Exit full screen" : "Full screen"}</span>
          </button>
        )}

        <button
          type="button"
          onClick={onToggleTutor}
          aria-pressed={tutorOpen}
          aria-label={tutorOpen ? "Hide tutor panel" : "Show tutor panel"}
          title={tutorOpen ? "Collapse the tutor panel" : "Open the tutor panel"}
          className={cn(
            "btn btn-ghost px-2.5 py-1.5 text-xs",
            tutorOpen ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {tutorOpen ? (
            <PanelRightClose className="h-4 w-4" />
          ) : (
            <PanelRightOpen className="h-4 w-4" />
          )}
          <span className="hidden sm:inline">{tutorOpen ? "Hide tutor" : "Show tutor"}</span>
        </button>
      </div>
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

export interface StudySurfaceProps {
  courseId: string;
  courseCode: string;
  /** The material currently open, if any. Enables the material/split views. */
  material?: Material | undefined;
  view: StudyView;
  onViewChange: (view: StudyView) => void;
  selectedNoteId: string | null;
  onSelectNote: (id: string) => void;
  onBack: () => void;
  onGenerateNotes?: (() => void) | undefined;
  generating?: boolean | undefined;
  onOpenMaterial?: ((id: string) => void) | undefined;
}

export function StudySurface({
  courseId,
  courseCode,
  material,
  view,
  onViewChange,
  selectedNoteId,
  onSelectNote,
  onBack,
  onGenerateNotes,
  generating = false,
  onOpenMaterial,
}: StudySurfaceProps) {
  const chat = useTutorChat(courseId);
  const [draft, setDraft] = useState("");
  const [tutorOpen, setTutorOpen] = useState(true);
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const { focus, toggleFocus, setFocus } = useLayout();
  const surfaceHeight = focus ? SURFACE_HEIGHT_FOCUS : SURFACE_HEIGHT;

  // Leaving the page always closes full screen, so its state never leaks to
  // another route.
  useEffect(() => () => setFocus(false), [setFocus]);

  // A transcript only exists for video/audio material that has been transcribed.
  const isVideo = material?.type === "video";
  const transcript = useTranscript(material?.id ?? "", !!isVideo);
  const transcriptAvailable =
    !!isVideo &&
    ((transcript.data?.length ?? 0) > 0 ||
      transcript.isLoading ||
      material?.status === "processing");

  const hasMaterial = !!material;
  const materialLabel = material?.type === "pdf" ? "View PDF" : "View Material";
  const activeView: StudyView =
    (view === "material" || view === "split" || view === "transcript") && !hasMaterial
      ? "notes"
      : view === "transcript" && !transcriptAvailable
        ? "notes"
        : view;

  const notesPane = (
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
  const materialPane = material ? (
    <MaterialViewer material={material} showTranscript={false} />
  ) : null;
  const transcriptPane = material ? <MaterialViewer material={material} showTranscript /> : null;
  const tutorPane = (
    <div className="card flex h-full min-h-0 flex-col overflow-hidden">
      <TutorChat
        courseCode={courseCode}
        messages={chat.messages}
        pending={chat.pending}
        value={draft}
        onValueChange={setDraft}
        onSend={chat.send}
        onRetry={chat.retry}
        onReset={chat.reset}
      />
    </div>
  );

  const options: ViewOption[] = [
    { value: "notes", label: "Notes", icon: NotebookPen, disabled: false, title: "Show notes" },
    {
      value: "transcript",
      label: "Transcript",
      icon: Mic,
      disabled: !transcriptAvailable,
      title: hasMaterial
        ? "No transcript is available for this material"
        : "Open a video material to see its transcript",
    },
    {
      value: "material",
      label: materialLabel,
      icon: BookOpen,
      disabled: !hasMaterial,
      title: "Open a material first",
    },
    {
      value: "split",
      label: "Split Screen",
      icon: Layers,
      disabled: !hasMaterial,
      title: "Open a material first",
    },
  ];

  // The content panels for the active view (independent of the tutor).
  const contentPanels: Array<{ id: string; min: number; node: ReactNode }> = [];
  if (activeView === "split" && material) {
    contentPanels.push({ id: "material", min: MATERIAL_MIN, node: materialPane });
    contentPanels.push({ id: "notes", min: NOTES_MIN, node: notesPane });
  } else if (activeView === "material" && material) {
    contentPanels.push({ id: "material", min: MATERIAL_MIN, node: materialPane });
  } else if (activeView === "transcript" && material) {
    contentPanels.push({ id: "transcript", min: MATERIAL_MIN, node: transcriptPane });
  } else {
    contentPanels.push({ id: "notes", min: NOTES_MIN, node: notesPane });
  }

  const panelIds = contentPanels.map((panel) => panel.id).join("+");
  const groupKey = `${panelIds}:${tutorOpen ? "tutor" : "solo"}`;
  const layoutKey = `studyai.surface.${groupKey}`;

  const storedLayout = useMemo(() => readStoredLayout(layoutKey), [layoutKey]);
  const defaultLayout = useMemo<Record<string, number>>(() => {
    const needed = [...contentPanels, ...(tutorOpen ? [{ id: "tutor" }] : [])].map((p) => p.id);
    if (storedLayout && needed.every((id) => typeof storedLayout[id] === "number")) {
      return storedLayout;
    }
    const layout: Record<string, number> = {};
    if (!tutorOpen) {
      contentPanels.forEach((panel) => (layout[panel.id] = 100 / contentPanels.length));
      return layout;
    }
    if (panelIds === "material+notes") {
      layout["material"] = 40;
      layout["notes"] = 28;
      layout["tutor"] = 32;
    } else {
      contentPanels.forEach((panel) => (layout[panel.id] = 62));
      layout["tutor"] = 38;
    }
    return layout;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutKey, storedLayout]);

  const saveLayout = useCallback(
    (layout: Record<string, number>) => {
      try {
        window.localStorage.setItem(layoutKey, JSON.stringify(layout));
      } catch {
        /* ignore storage failures */
      }
    },
    [layoutKey],
  );

  const toolbar = (
    <ViewToolbar
      view={activeView}
      onChange={onViewChange}
      options={options}
      tutorOpen={tutorOpen}
      onToggleTutor={() => setTutorOpen((open) => !open)}
      focus={focus}
      onToggleFocus={toggleFocus}
      showFocusControl={!focus}
    />
  );

  const title = material ? material.name : "Study workspace";

  if (!isDesktop) {
    // Compact stacked layout: each pane scrolls on its own and stays reachable.
    const stacked = (
      <div>
        {toolbar}
        <div className="space-y-4">
          {contentPanels.map((panel) => (
            <div key={panel.id} className="h-[55vh] min-h-[380px]">
              {panel.node}
            </div>
          ))}
          {tutorOpen && <div className="h-[60vh] min-h-[420px]">{tutorPane}</div>}
        </div>
      </div>
    );

    if (focus) {
      return (
        <FullScreenPage title={title} onClose={toggleFocus}>
          <div className="min-h-0 flex-1 overflow-auto">{stacked}</div>
        </FullScreenPage>
      );
    }
    return stacked;
  }

  const elements: ReactNode[] = [];
  contentPanels.forEach((panel, index) => {
    if (index > 0) {
      elements.push(<PanelDivider key={`sep-${panel.id}`} label="Resize study panels" />);
    }
    elements.push(
      <Panel key={panel.id} id={panel.id} minSize={panel.min} className="min-w-0 overflow-hidden">
        <div className="h-full min-h-0">{panel.node}</div>
      </Panel>,
    );
  });
  if (tutorOpen) {
    elements.push(<PanelDivider key="sep-tutor" label="Resize content and tutor panels" />);
    elements.push(
      <Panel key="tutor" id="tutor" minSize={TUTOR_MIN} className="min-w-0 overflow-hidden">
        <div className="h-full min-h-0">{tutorPane}</div>
      </Panel>,
    );
  }

  const group = (
    <Group
      key={groupKey}
      id={`study-surface-${groupKey}`}
      orientation="horizontal"
      className={surfaceHeight}
      defaultLayout={defaultLayout}
      onLayoutChanged={saveLayout}
    >
      {elements}
    </Group>
  );

  if (focus) {
    return (
      <FullScreenPage title={title} onClose={toggleFocus}>
        {toolbar}
        {group}
      </FullScreenPage>
    );
  }

  return (
    <div>
      {toolbar}
      {group}
    </div>
  );
}
