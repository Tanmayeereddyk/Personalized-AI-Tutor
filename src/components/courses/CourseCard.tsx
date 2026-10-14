import { Link } from "@tanstack/react-router";
import { ArrowRight, Plus } from "lucide-react";
import type { Course } from "@/lib/types";
import { CourseBadge, ProgressBar, masteryTone } from "@/components/ui/kit";
import { useStore } from "@/lib/store";
import { useQuizzes } from "@/lib/queries";
import { calculateMastery } from "@/lib/mastery";

export function CourseCard({ course, index = 0 }: { course: Course; index?: number }) {
  const quizzes = useQuizzes(course.id);
  const mastery = calculateMastery(quizzes.data ?? [], course.id);
  return (
    <Link
      to="/courses/$courseId" params={{ courseId: course.id }}
      className="card lift fade-up group flex flex-col p-5"
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <div className="flex items-center justify-between">
        <CourseBadge icon={course.icon} color={course.color} />
        <span className="chip font-mono">{course.code}</span>
      </div>
      <h3 className="mt-5 line-clamp-2 min-h-[2.75rem] font-medium leading-snug">{course.name}</h3>
      <div className="mt-5 flex items-baseline justify-between text-sm">
        <span className="text-muted-foreground">Overall mastery</span>
        <span className="font-mono font-medium">
          {quizzes.isLoading
            ? "Loading…"
            : quizzes.isError
              ? "Unavailable"
              : mastery
                ? `${mastery.percent}%`
                : "Not attempted"}
        </span>
      </div>
      <ProgressBar value={mastery?.percent ?? 0} tone={mastery ? masteryTone(mastery.percent) : "primary"} className="mt-2" />
      <div className="mt-4 text-xs text-muted-foreground">{course.topicCount} topics · {course.materialCount} materials</div>
      <div className="mt-5 flex items-center gap-1.5 text-sm font-medium text-primary">
        Open Course <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
      </div>
    </Link>
  );
}

export function AddCourseCard() {
  const { setAddCourseOpen } = useStore();
  return (
    <button
      onClick={() => setAddCourseOpen(true)}
      className="group flex min-h-[260px] flex-col items-center justify-center rounded-[var(--radius-2xl)] border border-dashed border-foreground/15 bg-transparent p-5 text-muted-foreground transition hover:border-primary/60 hover:bg-primary/5 hover:text-primary"
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-dashed border-current transition group-hover:rotate-90">
        <Plus className="h-5 w-5" />
      </span>
      <span className="mt-3 font-medium">Add Course</span>
      <span className="mt-1 text-xs opacity-70">Start a new study space</span>
    </button>
  );
}
