import { createFileRoute, Link } from "@tanstack/react-router";
import { BookOpen, FolderOpen, Loader2, Network } from "lucide-react";
import { useCourse } from "@/lib/store";
import { useMaterials, useTopics } from "@/lib/queries";
import { EmptyState } from "@/components/ui/kit";
import { TutorAside } from "@/components/study/TutorAside";

export const Route = createFileRoute("/courses/$courseId/")({
  component: Overview,
});

function Overview() {
  const { courseId } = Route.useParams();
  const course = useCourse(courseId);
  const materials = useMaterials(courseId);
  const topics = useTopics(courseId);
  if (!course) return null;

  const count = materials.data?.length ?? 0;
  const topicCount = topics.data?.length ?? 0;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
        <div className="space-y-5">
          <div className="card p-6">
            <div className="text-sm font-medium">Course Materials</div>
            <div className="mt-4 font-mono text-4xl font-semibold">{count}</div>
            <p className="mt-2 text-sm text-muted-foreground">
              {count === 1 ? "file uploaded to this course" : "files uploaded to this course"}
            </p>
            <Link
              to="/courses/$courseId/materials"
              params={{ courseId }}
              className="btn btn-primary mt-5 w-full"
            >
              <FolderOpen className="h-4 w-4" />
              Manage materials
            </Link>
          </div>
        </div>

        <div className="card p-6">
          <div className="text-sm font-medium">Topic mastery</div>
          {topics.isLoading ? (
            <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading topics…
            </div>
          ) : topicCount > 0 ? (
            <>
              <div className="mt-4 font-mono text-4xl font-semibold">{topicCount}</div>
              <p className="mt-2 text-sm text-muted-foreground">
                {topicCount === 1
                  ? "topic mapped from your materials"
                  : "topics mapped from your materials"}
              </p>
              <Link
                to="/courses/$courseId/topics"
                params={{ courseId }}
                className="btn btn-primary mt-5 w-full"
              >
                <Network className="h-4 w-4" />
                View topics
              </Link>
            </>
          ) : (
            <EmptyState
              icon={BookOpen}
              title="No topics tracked yet"
              body="Upload materials and the knowledge map is generated automatically as they are processed — or generate it yourself from the Topics page."
              action={
                <Link
                  to="/courses/$courseId/materials"
                  params={{ courseId }}
                  className="btn btn-primary"
                >
                  Add materials
                </Link>
              }
            />
          )}
        </div>
      </div>

      <TutorAside courseId={courseId} courseCode={course.code} />
    </div>
  );
}
