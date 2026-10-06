import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, Lightbulb, ListChecks, BookOpen } from "lucide-react";
import { getTopics, useCourse } from "@/lib/store";
import { EmptyState, ProgressBar, Ring, masteryTone } from "@/components/ui/kit";

export const Route = createFileRoute("/courses/$courseId/")({
  component: Overview,
});

function Overview() {
  const { courseId } = Route.useParams();
  const course = useCourse(courseId);
  const topics = getTopics(courseId).slice(0, 7);
  if (!course) return null;
  const weakest = [...topics].sort((a, b) => a.mastery - b.mastery)[0];

  if (topics.length === 0) {
    return <EmptyState icon={BookOpen} title="Nothing to track yet" body="Upload materials to this course and StudyAI will map out topics and start measuring your mastery."
      action={<Link to="/courses/$courseId/materials" params={{ courseId }} className="btn btn-primary">Add Materials</Link>} />;
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
      <div className="space-y-5">
        <div className="card glow-bg flex flex-col items-center p-6">
          <div className="self-start text-sm font-medium">Overall Mastery</div>
          <div className="relative mt-4">
            <Ring value={course.mastery} size={170} />
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="font-mono text-4xl font-semibold">{course.mastery}%</span>
              <span className="text-xs text-muted-foreground">{course.topicCount} topics</span>
            </div>
          </div>
        </div>
        {weakest && (
          <div className="card border-warning/30 p-6">
            <div className="flex items-center gap-2 text-sm font-medium"><Lightbulb className="h-4 w-4 text-warning" />Recommended for you</div>
            <p className="mt-3 text-sm text-muted-foreground">You're struggling with <span className="text-foreground">{weakest.name}</span>. A quick review and practice set should help.</p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link to="/courses/$courseId/notes" params={{ courseId }} className="btn btn-ghost">Review Topic</Link>
              <Link to="/courses/$courseId/quizzes" params={{ courseId }} className="btn btn-primary"><ListChecks className="h-4 w-4" />Take Practice Quiz</Link>
            </div>
          </div>
        )}
      </div>

      <div className="card p-6">
        <div className="mb-5 text-sm font-medium">Topic Mastery</div>
        <div className="space-y-5">
          {topics.map((t) => {
            const weak = t.mastery < 50;
            return (
              <div key={t.id}>
                <div className="mb-2 flex items-center justify-between text-sm">
                  <span className={weak ? "flex items-center gap-1.5 text-warning" : ""}>
                    {weak && <AlertTriangle className="h-3.5 w-3.5" />}{t.name}
                  </span>
                  <span className="font-mono text-muted-foreground">{t.mastery}%</span>
                </div>
                <ProgressBar value={t.mastery} tone={masteryTone(t.mastery)} />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
