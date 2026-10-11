import { createFileRoute } from "@tanstack/react-router";
import { GitBranch, FileText, Network } from "lucide-react";
import { getTopics } from "@/lib/store";
import { EmptyState, PageHeader, ProgressBar, masteryTone } from "@/components/ui/kit";

export const Route = createFileRoute("/courses/$courseId/topics")({
  component: Topics,
});

function Topics() {
  const { courseId } = Route.useParams();
  const topics = getTopics(courseId);
  const groups = topics.reduce<Record<string, typeof topics>>(
    (acc, t) => ((acc[t.group] ??= []).push(t), acc),
    {},
  );

  return (
    <div>
      <PageHeader
        title="Topics"
        subtitle="Your course knowledge map, with mastery for each concept."
      />
      {topics.length === 0 ? (
        <EmptyState
          icon={Network}
          title="No topics mapped yet"
          body="Topics appear automatically once your materials are processed."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Object.entries(groups).map(([group, ts], gi) => {
            const avg = Math.round(ts.reduce((s, t) => s + t.mastery, 0) / ts.length);
            return (
              <div
                key={group}
                className="card lift fade-up p-5"
                style={{ animationDelay: `${gi * 60}ms` }}
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-medium">{group}</h3>
                  <span className="font-mono text-sm text-muted-foreground">{avg}%</span>
                </div>
                <ul className="mt-4 space-y-3 border-l border-dashed pl-4">
                  {ts.map((t) => (
                    <li key={t.id} className="relative">
                      <span className="absolute -left-4 top-2.5 h-px w-3 bg-border" />
                      <div className="flex items-center justify-between text-sm">
                        <span>{t.name}</span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {t.mastery}%
                        </span>
                      </div>
                      <ProgressBar
                        value={t.mastery}
                        tone={masteryTone(t.mastery)}
                        className="mt-1.5 h-1"
                      />
                      <div className="mt-1.5 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <FileText className="h-3 w-3" />
                          {t.resources} resources
                        </span>
                        {t.prerequisite && (
                          <span className="flex items-center gap-1">
                            <GitBranch className="h-3 w-3" />
                            Needs {t.prerequisite}
                          </span>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
