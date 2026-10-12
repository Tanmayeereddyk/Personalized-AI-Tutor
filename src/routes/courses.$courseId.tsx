import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, Loader2, Pencil, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useCourse, useStore } from "@/lib/store";
import { CourseBadge } from "@/components/ui/kit";
import { EditCourseModal } from "@/components/courses/AddCourseModal";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/courses/$courseId")({
  head: ({ params }) => ({
    meta: [
      { title: `${params.courseId.toUpperCase()} — StudyAI` },
      { name: "description", content: "Course overview, materials, notes and practice on StudyAI." },
      { property: "og:title", content: `${params.courseId.toUpperCase()} — StudyAI` },
      { property: "og:description", content: "Course overview, materials, notes and practice on StudyAI." },
    ],
  }),
  component: CourseLayout,
});

const tabs = [
  { to: "/courses/$courseId", label: "Overview", exact: true },
  { to: "/courses/$courseId/materials", label: "Materials" },
  { to: "/courses/$courseId/topics", label: "Topics" },
  { to: "/courses/$courseId/notes", label: "Notes" },
  { to: "/courses/$courseId/quizzes", label: "Quizzes" },
  { to: "/courses/$courseId/flashcards", label: "Flashcards" },
  { to: "/courses/$courseId/assessments", label: "Assessments" },
] as const;

function CourseLayout() {
  const { courseId } = Route.useParams();
  const course = useCourse(courseId);
  const { coursesLoading, removeCourse, reloadCourses } = useStore();
  const navigate = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const isTutor = path.endsWith("/tutor");
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState(false);

  if (!course) {
    if (coursesLoading) {
      return (
        <div className="flex items-center justify-center gap-2 py-20 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />Loading course…
        </div>
      );
    }
    return (
      <div className="card py-20 text-center">
        <h1 className="text-xl font-semibold">Course not found</h1>
        <p className="mt-1 text-sm text-muted-foreground">It may have been removed, or it belongs to another account.</p>
        <Link to="/courses" className="btn btn-ghost mt-6">Back to courses</Link>
      </div>
    );
  }

  const removeThisCourse = async () => {
    if (!window.confirm(`Delete “${course.name}”? This removes its materials, notes and practice data. This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await removeCourse(course.id);
      toast.success("Course deleted.");
      navigate({ to: "/courses" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete the course.");
      reloadCourses();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div>
      <Link to="/courses" className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />All courses
      </Link>
      <div className="flex flex-wrap items-center justify-between gap-5">
        <div className="flex items-center gap-4">
          <CourseBadge icon={course.icon} color={course.color} size="lg" />
          <div>
            <div className="flex items-center gap-2">
              <span className="chip font-mono">{course.code}</span>
              <span className="text-sm text-muted-foreground">{course.mastery}% overall mastery</span>
            </div>
            <h1 className="mt-1.5 text-2xl font-semibold tracking-tight sm:text-3xl">{course.name}</h1>
            {course.description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{course.description}</p>}
          </div>
        </div>
        {!isTutor && (
          <div className="flex items-center gap-2">
            <button className="btn btn-ghost" onClick={() => setEditing(true)} disabled={deleting}>
              <Pencil className="h-4 w-4" />Edit
            </button>
            <button className="btn btn-ghost text-destructive" onClick={removeThisCourse} disabled={deleting}>
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}Delete
            </button>
            <Link to="/courses/$courseId/tutor" params={{ courseId }} className="btn btn-primary px-5 py-2.5">
              <Sparkles className="h-4 w-4" />Ask Tutor
            </Link>
          </div>
        )}
      </div>

      <nav className="-mx-4 mt-8 overflow-x-auto border-b px-4 sm:mx-0 sm:px-0">
        <div className="flex gap-1">
          {tabs.map((t) => {
            const href = t.to.replace("$courseId", courseId);
            const active = "exact" in t ? path === href || path === href + "/" : path.startsWith(href);
            return (
              <Link key={t.label} to={t.to} params={{ courseId }}
                className={cn("relative whitespace-nowrap px-3.5 py-2.5 text-sm transition-colors",
                  active ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
                {t.label}
                {active && <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary shadow-[0_0_12px] shadow-primary" />}
              </Link>
            );
          })}
          {isTutor && (
            <span className="relative flex items-center gap-1.5 whitespace-nowrap px-3.5 py-2.5 text-sm text-foreground">
              <Sparkles className="h-3.5 w-3.5 text-primary" />Tutor
              <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />
            </span>
          )}
        </div>
      </nav>

      <div className="fade-up pt-8" key={path}>
        <Outlet />
      </div>

      <EditCourseModal course={course} open={editing} onOpenChange={setEditing} />
    </div>
  );
}
