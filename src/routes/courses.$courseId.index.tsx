import { createFileRoute, Link } from "@tanstack/react-router";
import { BookOpen, FolderOpen } from "lucide-react";
import { useCourse } from "@/lib/store";
import { useMaterials } from "@/lib/queries";
import { EmptyState } from "@/components/ui/kit";

export const Route = createFileRoute("/courses/$courseId/")({
  component: Overview,
});

function Overview() {
  const { courseId } = Route.useParams();
  const course = useCourse(courseId);
  const materials = useMaterials(courseId);
  if (!course) return null;

  const count = materials.data?.length ?? 0;

  return (
    <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
      <div className="space-y-5">
        <div className="card p-6">
          <div className="text-sm font-medium">Course Materials</div>
          <div className="mt-4 font-mono text-4xl font-semibold">{count}</div>
          <p className="mt-2 text-sm text-muted-foreground">
            {count === 1 ? "file uploaded to this course" : "files uploaded to this course"}
          </p>
          <Link to="/courses/$courseId/materials" params={{ courseId }} className="btn btn-primary mt-5 w-full">
            <FolderOpen className="h-4 w-4" />Manage materials
          </Link>
        </div>
      </div>

      <div className="card flex flex-col p-6">
        <div className="mb-5 text-sm font-medium">Topic mastery</div>
        <EmptyState
          icon={BookOpen}
          title="No topics tracked yet"
          body="StudyAI maps topics and measures mastery from your course materials. That automatic processing isn't available yet, so nothing is shown here — your materials are safe and ready."
          action={
            <Link to="/courses/$courseId/materials" params={{ courseId }} className="btn btn-primary">
              Add materials
            </Link>
          }
        />
      </div>
    </div>
  );
}
