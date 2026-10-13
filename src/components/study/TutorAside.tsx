import { useState } from "react";
import { PanelRightClose, PanelRightOpen, Sparkles } from "lucide-react";

import { CourseTutor } from "@/components/tutor/CourseTutor";

/**
 * The AI Tutor as a persistent right-side panel for a course/study-set page.
 *
 * It is collapsed (not removed) so the page content can take the full width,
 * and reopened with the same toggle. The chat itself is owned by `CourseTutor`,
 * which remembers the conversation per user + course.
 */
export function TutorAside({ courseId, courseCode }: { courseId: string; courseCode: string }) {
  const [open, setOpen] = useState(true);

  return (
    <aside className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5 text-primary" />
          AI Tutor
        </span>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-pressed={open}
          aria-label={open ? "Hide tutor panel" : "Show tutor panel"}
          title={open ? "Collapse the tutor panel" : "Open the tutor panel"}
          className="btn btn-ghost ml-auto px-2.5 py-1.5 text-xs"
        >
          {open ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
          <span>{open ? "Hide" : "Show"}</span>
        </button>
      </div>

      {open ? (
        <div className="card flex h-[calc(100dvh-22rem)] min-h-[520px] flex-col overflow-hidden">
          <CourseTutor courseId={courseId} courseCode={courseCode} />
        </div>
      ) : (
        <div className="card flex flex-col items-center gap-3 border-dashed px-5 py-8 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/15 text-primary">
            <Sparkles className="h-5 w-5" />
          </span>
          <p className="text-sm text-muted-foreground">
            The tutor is hidden. Reopen it to keep asking questions about this course.
          </p>
          <button className="btn btn-primary" onClick={() => setOpen(true)}>
            <Sparkles className="h-4 w-4" />
            Open tutor
          </button>
        </div>
      )}
    </aside>
  );
}
