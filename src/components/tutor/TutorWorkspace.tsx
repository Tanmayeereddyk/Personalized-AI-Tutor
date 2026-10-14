import { useCallback, useRef, useState } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import {
  GripVertical,
  MessagesSquare,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Sparkles,
} from "lucide-react";

import { useIsMobile } from "@/hooks/use-mobile";
import { useCourse } from "@/lib/store";
import { cn } from "@/lib/utils";
import { NotesPanel } from "./NotesPanel";
import { TutorChat } from "./TutorChat";
import { useTutorChat } from "./useTutorChat";

/**
 * The study workspace for a course: a notes/reference panel beside the tutor
 * chat, split by a draggable divider.
 *
 * - No reference open  -> the tutor fills the width.
 * - Reference open     -> notes on the left, tutor on the right (≈65% / 35%).
 * - Tutor collapsed    -> notes fill the width.
 * - Narrow screens     -> a single pane with a Tutor/Notes switch.
 *
 * Resizing is handled by the project's existing `react-resizable-panels`
 * dependency, so pointer dragging, arrow-key resizing, focus and hit-target
 * sizing all come for free. The chosen split is remembered per browser.
 */

const NOTES_WIDTH_KEY = "studyai.tutor.notesWidth";
const DEFAULT_NOTES_WIDTH = 65;
const MIN_NOTES_WIDTH = 260; // px
const MIN_TUTOR_WIDTH = 320; // px

function readStoredNotesWidth(): number {
  if (typeof window === "undefined") return DEFAULT_NOTES_WIDTH;
  try {
    const value = Number(window.localStorage.getItem(NOTES_WIDTH_KEY));
    return Number.isFinite(value) && value >= 20 && value <= 80 ? value : DEFAULT_NOTES_WIDTH;
  } catch {
    return DEFAULT_NOTES_WIDTH;
  }
}

function ToolButton({
  active,
  onClick,
  label,
  title,
  icon: Icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  title: string;
  icon: typeof PanelLeftOpen;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active
          ? "bg-primary/10 text-foreground"
          : "text-muted-foreground hover:bg-secondary hover:text-foreground",
      )}
    >
      <Icon className="h-4 w-4" />
      <span className="hidden md:inline">{label}</span>
    </button>
  );
}

export function TutorWorkspace({ courseId }: { courseId: string }) {
  const course = useCourse(courseId);
  const isMobile = useIsMobile();
  const chat = useTutorChat(courseId);

  const [notesOpen, setNotesOpen] = useState(false);
  const [tutorCollapsed, setTutorCollapsed] = useState(false);
  const [mobileView, setMobileView] = useState<"tutor" | "notes">("tutor");
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const notesWidth = useRef(readStoredNotesWidth());
  const courseCode = course?.code ?? "Course";

  const rememberWidth = useCallback((layout: { [id: string]: number }) => {
    const width = layout["notes"];
    if (typeof width === "number" && width >= 20 && width <= 80) {
      notesWidth.current = width;
      try {
        window.localStorage.setItem(NOTES_WIDTH_KEY, String(width));
      } catch {
        /* ignore storage failures */
      }
    }
  }, []);

  const notesPanel = (
    <NotesPanel
      courseId={courseId}
      selectedNoteId={selectedNoteId}
      onSelectNote={setSelectedNoteId}
      onBack={() => setSelectedNoteId(null)}
      onClose={() => setNotesOpen(false)}
    />
  );

  const tutorPanel = (
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
  );

  const bothHidden = !notesOpen && tutorCollapsed;

  return (
    <div className="card flex h-[calc(100dvh-19rem)] min-h-[560px] flex-col overflow-hidden">
      {/* Workspace toolbar — always visible so both panels stay reachable. */}
      <div className="flex shrink-0 items-center gap-2 border-b px-2.5 py-2">
        <div className="flex items-center gap-2 px-1.5 text-xs font-medium text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          <span className="hidden sm:inline">Study workspace</span>
          <span className="chip font-mono">{courseCode}</span>
        </div>

        {isMobile ? (
          <div
            className="ml-auto inline-flex rounded-lg border p-0.5"
            role="group"
            aria-label="Workspace view"
          >
            {(["tutor", "notes"] as const).map((view) => (
              <button
                key={view}
                type="button"
                aria-pressed={mobileView === view}
                onClick={() => setMobileView(view)}
                className={cn(
                  "rounded-md px-3 py-1 text-xs font-medium capitalize transition-colors",
                  mobileView === view
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {view}
              </button>
            ))}
          </div>
        ) : (
          <div className="ml-auto flex items-center gap-1">
            <ToolButton
              active={notesOpen}
              onClick={() => setNotesOpen((o) => !o)}
              label={notesOpen ? "Hide notes" : "Show notes"}
              title={notesOpen ? "Hide notes panel" : "Show notes panel"}
              icon={notesOpen ? PanelLeftClose : PanelLeftOpen}
            />
            <ToolButton
              active={tutorCollapsed}
              onClick={() => setTutorCollapsed((c) => !c)}
              label={tutorCollapsed ? "Show tutor" : "Hide tutor"}
              title={tutorCollapsed ? "Show tutor panel" : "Collapse tutor panel"}
              icon={tutorCollapsed ? PanelRightOpen : PanelRightClose}
            />
          </div>
        )}
      </div>

      {/* Panels. */}
      <div className="min-h-0 flex-1">
        {isMobile ? (
          <div className="h-full min-h-0">{mobileView === "tutor" ? tutorPanel : notesPanel}</div>
        ) : bothHidden ? (
          <div className="flex h-full items-center justify-center p-6">
            <div className="max-w-sm text-center">
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary text-primary">
                <MessagesSquare className="h-6 w-6" />
              </span>
              <p className="mt-4 font-medium">The tutor is hidden</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Reopen it to keep chatting, or browse your notes for this course.
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-2">
                <button className="btn btn-primary" onClick={() => setTutorCollapsed(false)}>
                  <MessagesSquare className="h-4 w-4" />
                  Open tutor
                </button>
                <button className="btn btn-ghost" onClick={() => setNotesOpen(true)}>
                  Show notes
                </button>
              </div>
            </div>
          </div>
        ) : notesOpen && tutorCollapsed ? (
          <div className="h-full min-h-0">{notesPanel}</div>
        ) : notesOpen ? (
          <Group
            id="tutor-workspace"
            orientation="horizontal"
            className="h-full w-full"
            onLayoutChanged={rememberWidth}
          >
            <Panel
              id="notes"
              defaultSize={`${notesWidth.current}%`}
              minSize={MIN_NOTES_WIDTH}
              maxSize="75%"
              className="min-w-0 overflow-hidden"
            >
              <div className="h-full min-h-0">{notesPanel}</div>
            </Panel>

            <Separator
              id="tutor-divider"
              aria-label="Resize notes and tutor panels"
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

            <Panel id="tutor" minSize={MIN_TUTOR_WIDTH} className="min-w-0 overflow-hidden">
              <div className="h-full min-h-0">{tutorPanel}</div>
            </Panel>
          </Group>
        ) : (
          <div className="h-full min-h-0">{tutorPanel}</div>
        )}
      </div>
    </div>
  );
}
