import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, Clock, Library, Target } from "lucide-react";
import { useStore } from "@/lib/store";
import { Greeting } from "@/components/dashboard/Greeting";
import { CourseCard, AddCourseCard } from "@/components/courses/CourseCard";
import { CourseBadge, EmptyState, ProgressBar } from "@/components/ui/kit";
import { useEvents, sortEvents, todayKey, formatTime } from "@/lib/events";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — StudyAI" },
      { name: "description", content: "Your personal study dashboard: continue learning, track mastery and jump into your courses." },
      { property: "og:title", content: "Dashboard — StudyAI" },
      { property: "og:description", content: "Your personal study dashboard on StudyAI." },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const { user, courses, setAddCourseOpen } = useStore();
  const { events } = useEvents();
  const upcoming = events.filter((e) => e.date >= todayKey()).sort(sortEvents).slice(0, 4);
  const resume = courses.find((c) => c.currentTopic) ?? courses[0];

  return (
    <div className="space-y-10">
      <Greeting name={user.name.split(" ")[0]!} />

      {resume && (
        <section className="card glow-bg fade-up relative overflow-hidden p-6 sm:p-8" style={{ animationDelay: "80ms" }}>
          <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-primary/10 blur-3xl" />
          <div className="relative grid gap-8 md:grid-cols-[1fr_auto] md:items-end">
            <div>
              <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-primary">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary" /> Continue learning
              </div>
              <div className="mt-4 flex items-center gap-3">
                <CourseBadge icon={resume.icon} color={resume.color} />
                <h2 className="text-xl font-semibold sm:text-2xl">{resume.name}</h2>
              </div>
              <div className="mt-6 grid max-w-xl gap-5 sm:grid-cols-3">
                <div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Target className="h-3.5 w-3.5" />Current topic</div>
                  <div className="mt-1 font-medium">{resume.currentTopic ?? "—"}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Mastery</div>
                  <div className="mt-1 font-mono font-medium">{resume.mastery}%</div>
                  <ProgressBar value={resume.mastery} className="mt-2" />
                </div>
                <div>
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Clock className="h-3.5 w-3.5" />Last studied</div>
                  <div className="mt-1 font-medium">{resume.lastStudied ?? "Not yet"}</div>
                </div>
              </div>
            </div>
            <Link to="/courses/$courseId/topics" params={{ courseId: resume.id }} className="btn btn-primary group px-5 py-3">
              Continue Learning <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
            </Link>
          </div>
        </section>
      )}

      <section>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">My Courses</h2>
          <Link to="/courses" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">View all <ArrowRight className="h-3.5 w-3.5" /></Link>
        </div>
        {courses.length === 0 ? (
          <EmptyState icon={Library} title="No courses yet." body="Add your first course and start building your personalized study space."
            action={<button className="btn btn-primary" onClick={() => setAddCourseOpen(true)}>+ Add Course</button>} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {courses.map((c, i) => <CourseCard key={c.id} course={c} index={i} />)}
            <AddCourseCard />
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-4 text-lg font-semibold">Coming up</h2>
        <div className="card divide-y">
          {upcoming.length === 0 && <div className="px-5 py-6 text-sm text-muted-foreground">No upcoming events</div>}
          {upcoming.map((e) => {
            const d = new Date(e.date + "T00:00:00");
            return (
              <div key={e.id} className="flex items-center gap-4 px-5 py-3.5">
                <div className="w-12 text-center">
                  <div className="text-[10px] uppercase text-muted-foreground">{d.toLocaleString("en", { month: "short" })}</div>
                  <div className="font-mono text-lg font-medium">{d.getDate()}</div>
                </div>
                <div className="flex-1 text-sm">{e.title}<div className="text-xs text-muted-foreground">{formatTime(e)}</div></div>
                {e.kind && <span className="chip capitalize">{e.kind}</span>}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
