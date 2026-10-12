import { createFileRoute } from "@tanstack/react-router";
import { useCourse } from "@/lib/store";
import { TutorUnavailable } from "@/components/practice/TutorUnavailable";

export const Route = createFileRoute("/courses/$courseId/tutor")({
  component: Tutor,
});

function Tutor() {
  const { courseId } = Route.useParams();
  const course = useCourse(courseId);

  return (
    <div className="h-[calc(100vh-22rem)] min-h-[480px]">
      <TutorUnavailable courseCode={course?.code} courseId={courseId} className="card h-full" />
    </div>
  );
}