import { createFileRoute } from "@tanstack/react-router";
import { Library, Plus } from "lucide-react";
import { useStore } from "@/lib/store";
import { CourseCard, AddCourseCard } from "@/components/courses/CourseCard";
import { EmptyState } from "@/components/ui/kit";

export const Route = createFileRoute("/courses/")({
  head: () => ({
    meta: [
      { title: "Your Courses — StudyAI" },
      { name: "description", content: "Everything you're learning, in one place." },
      { property: "og:title", content: "Your Courses — StudyAI" },
      { property: "og:description", content: "Everything you're learning, in one place." },
    ],
  }),
  component: CoursesPage,
});

function CoursesPage() {
  const { courses, coursesLoading, coursesError, reloadCourses, setAddCourseOpen } = useStore();
  return (
    <div>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl tracking-tight">Your Courses</h1>
          <p className="mt-1 text-muted-foreground">Everything you're learning, in one place.</p>
        </div>
        <button className="btn btn-primary" onClick={() => setAddCourseOpen(true)}><Plus className="h-4 w-4" />Add Course</button>
      </div>
      {coursesLoading ? (
        <div className="card px-6 py-16 text-center text-sm text-muted-foreground">Loading your courses…</div>
      ) : coursesError ? (
        <div className="card px-6 py-16 text-center">
          <p className="font-medium">Couldn't load your courses</p>
          <p className="mt-1 text-sm text-muted-foreground">{coursesError}</p>
          <button className="btn btn-primary mt-5" onClick={reloadCourses}>Try again</button>
        </div>
      ) : courses.length === 0 ? (
        <EmptyState icon={Library} title="No courses yet." body="Add your first course and start building your personalized study space."
          action={<button className="btn btn-primary" onClick={() => setAddCourseOpen(true)}>+ Add Course</button>} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {courses.map((c, i) => <CourseCard key={c.id} course={c} index={i} />)}
          <AddCourseCard />
        </div>
      )}
    </div>
  );
}
