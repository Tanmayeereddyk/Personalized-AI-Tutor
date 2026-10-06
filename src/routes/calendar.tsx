import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { calendarEvents } from "@/lib/mockData";
import type { EventKind } from "@/lib/types";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/calendar")({
  head: () => ({
    meta: [
      { title: "Calendar — StudyAI" },
      { name: "description", content: "Upcoming quizzes, assessments, study sessions and reminders." },
      { property: "og:title", content: "Calendar — StudyAI" },
      { property: "og:description", content: "Your study schedule at a glance." },
    ],
  }),
  component: CalendarPage,
});

const kindStyle: Record<EventKind, string> = {
  quiz: "bg-course-sky/15 text-course-sky",
  assessment: "bg-course-rose/15 text-course-rose",
  study: "bg-primary/15 text-primary",
  reminder: "bg-course-amber/15 text-course-amber",
};

function CalendarPage() {
  const [cursor, setCursor] = useState(() => new Date(2026, 9, 1));
  const y = cursor.getFullYear();
  const m = cursor.getMonth();
  const first = new Date(y, m, 1).getDay();
  const days = new Date(y, m + 1, 0).getDate();
  const key = (d: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const today = new Date();
  const cells = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];

  return (
    <div>
      <div className="mb-8">
        <h1 className="font-display text-4xl tracking-tight">Calendar</h1>
        <p className="mt-1 text-muted-foreground">Quizzes, assessments and planned study sessions.</p>
      </div>
      <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
        <div className="card p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-medium">{cursor.toLocaleString("en", { month: "long", year: "numeric" })}</h2>
            <div className="flex gap-1">
              <button className="btn btn-ghost h-8 w-8 p-0" onClick={() => setCursor(new Date(y, m - 1, 1))}><ChevronLeft className="h-4 w-4" /></button>
              <button className="btn btn-ghost h-8 w-8 p-0" onClick={() => setCursor(new Date(y, m + 1, 1))}><ChevronRight className="h-4 w-4" /></button>
            </div>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-[11px] uppercase text-muted-foreground">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d} className="py-2">{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((d, i) => {
              if (!d) return <div key={i} />;
              const evs = calendarEvents.filter((e) => e.date === key(d));
              const isToday = today.getFullYear() === y && today.getMonth() === m && today.getDate() === d;
              return (
                <div key={i} className={cn("min-h-16 rounded-lg border bg-background/50 p-1.5 sm:min-h-24", isToday && "border-primary/60")}>
                  <div className={cn("font-mono text-xs", isToday ? "text-primary" : "text-muted-foreground")}>{d}</div>
                  <div className="mt-1 space-y-1">
                    {evs.map((e) => (
                      <div key={e.id} className={cn("truncate rounded px-1.5 py-0.5 text-[10px] font-medium", kindStyle[e.kind])} title={e.title}>
                        <span className="hidden sm:inline">{e.title}</span><span className="sm:hidden">•</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="card p-5">
          <h2 className="mb-4 font-medium">Upcoming</h2>
          <div className="space-y-3">
            {calendarEvents.map((e) => {
              const d = new Date(e.date + "T00:00:00");
              return (
                <div key={e.id} className="flex items-center gap-3">
                  <div className="w-11 rounded-lg border bg-background py-1 text-center">
                    <div className="text-[9px] uppercase text-muted-foreground">{d.toLocaleString("en", { month: "short" })}</div>
                    <div className="font-mono text-sm">{d.getDate()}</div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">{e.title}</div>
                    <span className={cn("mt-0.5 inline-block rounded px-1.5 text-[10px] capitalize", kindStyle[e.kind])}>{e.kind}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
