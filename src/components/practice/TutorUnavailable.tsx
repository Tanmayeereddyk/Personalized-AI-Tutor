import { Link } from "@tanstack/react-router";
import { ArrowUp, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface TutorUnavailableProps {
  courseCode?: string | undefined;
  courseId?: string | undefined;
  className?: string | undefined;
}

/**
 * Honest "tutoring is not available yet" panel used both on the full Tutor
 * page and inside the Study Workspace side panel. It never fabricates answers
 * or grounding — tutoring simply isn't wired up on the backend yet.
 */
export function TutorUnavailable({ courseCode, courseId, className }: TutorUnavailableProps) {
  return (
    <div className={cn("flex flex-col overflow-hidden", className)}>
      <div className="flex items-center gap-3 border-b px-5 py-4">
        <Sparkles className="h-4 w-4 text-primary" />
        <div>
          <div className="text-sm font-medium">{courseCode ? `${courseCode} Tutor` : "Course Tutor"}</div>
          <div className="text-xs text-muted-foreground">Ask questions about your course material.</div>
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="max-w-md text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15 text-primary"><Sparkles className="h-6 w-6" /></span>
          <p className="mt-4 font-medium">The AI tutor isn't available yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            When enabled, this tutor will answer questions grounded in your uploaded materials and cite its sources. Until then,
            no answers are generated — so you won't see fabricated responses.
          </p>
          {courseId ? (
            <Link to="/courses/$courseId/materials" params={{ courseId }} className="btn btn-primary mt-6">
              Manage materials
            </Link>
          ) : null}
        </div>
      </div>
      <form className="border-t p-3" onSubmit={(e) => e.preventDefault()}>
        <div className="flex items-end gap-2 rounded-xl border bg-background p-2 opacity-60">
          <textarea
            value=""
            readOnly
            disabled
            rows={1}
            placeholder="Tutoring is coming soon…"
            className="max-h-32 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground"
          />
          <button type="submit" disabled className={cn("btn btn-primary h-9 w-9 p-0")} aria-label="Send"><ArrowUp className="h-4 w-4" /></button>
        </div>
      </form>
    </div>
  );
}