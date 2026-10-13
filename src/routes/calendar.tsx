import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import * as AlertDialog from "@radix-ui/react-alert-dialog";
import { CalendarDays, ChevronLeft, ChevronRight, Clock, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useEvents, sortEvents, formatTime, todayKey } from "@/lib/events";
import type { CalendarEvent, EventKind } from "@/lib/types";
import { Modal, Label } from "@/components/ui/kit";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/calendar")({
  head: () => ({
    meta: [
      { title: "Calendar — Lumio" },
      { name: "description", content: "Plan your study schedule: add, edit and track upcoming events." },
      { property: "og:title", content: "Calendar — Lumio" },
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
const styleOf = (e: CalendarEvent) => (e.kind ? kindStyle[e.kind] : "bg-primary/15 text-primary");
const longDate = (k: string) => new Date(k + "T00:00:00").toLocaleDateString("en", { weekday: "long", month: "long", day: "numeric", year: "numeric" });

type Draft = { title: string; date: string; startTime: string; endTime: string; description: string };

function CalendarPage() {
  const { events, loading, error, add, update, remove } = useEvents();
  const [cursor, setCursor] = useState(() => new Date(2026, 9, 1));
  const [today, setToday] = useState("");
  const [form, setForm] = useState<{ mode: "add" | "edit"; draft: Draft; id?: string } | null>(null);
  const [viewing, setViewing] = useState<CalendarEvent | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<CalendarEvent | null>(null);

  useEffect(() => {
    setToday(todayKey());
    const n = new Date();
    setCursor(new Date(n.getFullYear(), n.getMonth(), 1));
  }, []);

  const y = cursor.getFullYear();
  const m = cursor.getMonth();
  const first = new Date(y, m, 1).getDay();
  const days = new Date(y, m + 1, 0).getDate();
  const key = (d: number) => `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const cells = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const upcoming = events.filter((e) => e.date >= (today || "0")).sort(sortEvents).slice(0, 6);

  const openAdd = (date = today) => setForm({ mode: "add", draft: { title: "", date, startTime: "", endTime: "", description: "" } });
  const openEdit = (e: CalendarEvent) => {
    setViewing(null);
    setForm({ mode: "edit", id: e.id, draft: { title: e.title, date: e.date, startTime: e.startTime ?? "", endTime: e.endTime ?? "", description: e.description ?? "" } });
  };

  const save = async (d: Draft) => {
    const data = { title: d.title.trim(), date: d.date, startTime: d.startTime || undefined, endTime: d.endTime || undefined, description: d.description.trim() || undefined };
    try {
      if (form?.mode === "edit" && form.id) { await update(form.id, data); toast.success("Event updated successfully."); }
      else { await add(data); toast.success("Event added successfully."); }
      setForm(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the event.");
    }
  };

  return (
    <div>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-4xl tracking-tight">Calendar</h1>
          <p className="mt-1 text-muted-foreground">Quizzes, assessments and planned study sessions.</p>
        </div>
        <button className="btn btn-primary" onClick={() => openAdd()}><Plus className="h-4 w-4" />Add Event</button>
      </div>
      {error && (
        <div className="mb-5 rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Couldn't load your events: {error}
        </div>
      )}
      <div className="grid gap-5 lg:grid-cols-[1fr_300px]">
        <div className="card p-3 sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-2">
            <h2 className="font-medium">{cursor.toLocaleString("en", { month: "long", year: "numeric" })}</h2>
            <div className="flex items-center gap-1">
              <button className="btn btn-ghost h-8 px-3 text-xs" onClick={() => { const n = new Date(); setCursor(new Date(n.getFullYear(), n.getMonth(), 1)); }}>Today</button>
              <button className="btn btn-ghost h-8 w-8 p-0" aria-label="Previous month" onClick={() => setCursor(new Date(y, m - 1, 1))}><ChevronLeft className="h-4 w-4" /></button>
              <button className="btn btn-ghost h-8 w-8 p-0" aria-label="Next month" onClick={() => setCursor(new Date(y, m + 1, 1))}><ChevronRight className="h-4 w-4" /></button>
            </div>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-[11px] uppercase text-muted-foreground">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d} className="py-2"><span className="sm:hidden">{d[0]}</span><span className="hidden sm:inline">{d}</span></div>)}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {cells.map((d, i) => {
              if (!d) return <div key={i} />;
              const k = key(d);
              const evs = events.filter((e) => e.date === k).sort(sortEvents);
              const isToday = k === today;
              return (
                <div key={i} onClick={() => openAdd(k)} className={cn("min-h-14 min-w-0 cursor-pointer rounded-lg border bg-background/50 p-1 transition-colors hover:bg-secondary/40 sm:min-h-24 sm:p-1.5", isToday && "border-primary bg-primary/5")}>
                  <div className={cn("flex h-5 w-5 items-center justify-center rounded-full font-mono text-xs", isToday ? "bg-primary font-semibold text-primary-foreground" : "text-muted-foreground")}>{d}</div>
                  <div className="mt-1 space-y-1">
                    {evs.map((e) => (
                      <button key={e.id} onClick={(ev) => { ev.stopPropagation(); setViewing(e); }} title={e.title}
                        className={cn("block w-full truncate rounded px-1 py-0.5 text-left text-[10px] font-medium hover:opacity-80 sm:px-1.5", styleOf(e))}>
                        <span className="hidden sm:inline">{e.title}</span><span className="sm:hidden">•</span>
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="card self-start p-5">
          <h2 className="mb-4 font-medium">Upcoming Events</h2>
          {loading ? (
            <div className="py-6 text-center text-sm text-muted-foreground">Loading events…</div>
          ) : upcoming.length === 0 ? (
            <div className="py-6 text-center">
              <CalendarDays className="mx-auto h-6 w-6 text-muted-foreground" />
              <div className="mt-2 text-sm font-medium">No upcoming events</div>
              <p className="mt-1 text-xs text-muted-foreground">Add an event to start planning your study schedule.</p>
            </div>
          ) : (
            <div className="space-y-1">
              {upcoming.map((e) => {
                const d = new Date(e.date + "T00:00:00");
                return (
                  <button key={e.id} onClick={() => setViewing(e)} className="flex w-full items-center gap-3 rounded-lg p-1.5 text-left hover:bg-secondary/50">
                    <div className="w-11 shrink-0 rounded-lg border bg-background py-1 text-center">
                      <div className="text-[9px] uppercase text-muted-foreground">{d.toLocaleString("en", { month: "short" })}</div>
                      <div className="font-mono text-sm">{d.getDate()}</div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm">{e.title}</div>
                      <div className="text-xs text-muted-foreground">{formatTime(e)}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {form && (
        <EventForm key={form.id ?? "new"} mode={form.mode} initial={form.draft} onCancel={() => setForm(null)} onSave={save} />
      )}

      <Modal open={!!viewing} onOpenChange={(o) => !o && setViewing(null)} title={viewing?.title ?? ""}>
        {viewing && (
          <div>
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2 text-muted-foreground"><CalendarDays className="h-4 w-4" />{longDate(viewing.date)}</div>
              <div className="flex items-center gap-2 text-muted-foreground"><Clock className="h-4 w-4" />{formatTime(viewing)}</div>
              {viewing.description && <p className="whitespace-pre-wrap pt-2">{viewing.description}</p>}
            </div>
            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <button className="btn btn-ghost text-destructive" onClick={() => setConfirmDelete(viewing)}><Trash2 className="h-4 w-4" />Delete</button>
              <button className="btn btn-ghost" onClick={() => openEdit(viewing)}><Pencil className="h-4 w-4" />Edit</button>
              <button className="btn btn-primary" onClick={() => setViewing(null)}>Close</button>
            </div>
          </div>
        )}
      </Modal>

      <AlertDialog.Root open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialog.Portal>
          <AlertDialog.Overlay className="fixed inset-0 z-[60] bg-background/70 backdrop-blur-sm" />
          <AlertDialog.Content className="card fixed left-1/2 top-1/2 z-[60] w-[calc(100%-2rem)] max-w-sm -translate-x-1/2 -translate-y-1/2 bg-popover p-6 outline-none">
            <AlertDialog.Title className="text-lg font-semibold">Delete this event?</AlertDialog.Title>
            <AlertDialog.Description className="mt-1 text-sm text-muted-foreground">Are you sure you want to remove this event?</AlertDialog.Description>
            <div className="mt-6 flex justify-end gap-2">
              <AlertDialog.Cancel className="btn btn-ghost">Cancel</AlertDialog.Cancel>
              <AlertDialog.Action className="btn bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => { if (confirmDelete) { const id = confirmDelete.id; void remove(id).then(() => toast.success("Event deleted.")).catch((err: unknown) => toast.error(err instanceof Error ? err.message : "Could not delete the event.")); } setConfirmDelete(null); setViewing(null); }}>
                Delete
              </AlertDialog.Action>
            </div>
          </AlertDialog.Content>
        </AlertDialog.Portal>
      </AlertDialog.Root>
    </div>
  );
}

function EventForm({ mode, initial, onCancel, onSave }: { mode: "add" | "edit"; initial: Draft; onCancel: () => void; onSave: (d: Draft) => void }) {
  const [d, setD] = useState(initial);
  const [err, setErr] = useState<Partial<Record<"title" | "date" | "endTime", string>>>({});
  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setD({ ...d, [k]: e.target.value });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const errs: Partial<Record<"title" | "date" | "endTime", string>> = {};
    if (!d.title.trim()) errs.title = "Title is required.";
    if (!d.date) errs.date = "Date is required.";
    if (d.startTime && d.endTime && d.endTime <= d.startTime) errs.endTime = "End time must be after start time.";
    if (Object.keys(errs).length) return setErr(errs);
    onSave(d);
  };
  const E = ({ k }: { k: "title" | "date" | "endTime" }) => (err[k] ? <p className="mt-1.5 text-xs text-destructive">{err[k]}</p> : null);

  return (
    <Modal open onOpenChange={(o) => !o && onCancel()} title={mode === "add" ? "Add event" : "Edit event"}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <div><Label>Event title</Label><input className="field" value={d.title} onChange={set("title")} placeholder="e.g. DAA revision" autoFocus /><E k="title" /></div>
        <div><Label>Date</Label><input type="date" className="field" value={d.date} onChange={set("date")} /><E k="date" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Start time</Label><input type="time" className="field" value={d.startTime} onChange={set("startTime")} /></div>
          <div><Label>End time</Label><input type="time" className="field" value={d.endTime} onChange={set("endTime")} /></div>
        </div>
        <E k="endTime" />
        <div><Label>Description</Label><textarea className="field min-h-20 resize-none" value={d.description} onChange={set("description")} placeholder="Optional" /></div>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn btn-primary">{mode === "add" ? "Add Event" : "Save changes"}</button>
        </div>
      </form>
    </Modal>
  );
}
