import { useEffect, useState } from "react";
import { calendarEvents as seed } from "./mockData";
import type { CalendarEvent } from "./types";

/** Calendar events persisted in localStorage. Swap for API calls later. */
const KEY = "studyai.events";

export function useEvents() {
  const [events, setEvents] = useState<CalendarEvent[]>(seed);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    try {
      const s = localStorage.getItem(KEY);
      if (s) setEvents(JSON.parse(s));
    } catch {
      /* ignore */
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) localStorage.setItem(KEY, JSON.stringify(events));
  }, [events, loaded]);

  return {
    events,
    add: (e: Omit<CalendarEvent, "id">) =>
      setEvents((p) => [...p, { ...e, id: crypto.randomUUID() }]),
    update: (id: string, patch: Partial<CalendarEvent>) =>
      setEvents((p) => p.map((e) => (e.id === id ? { ...e, ...patch } : e))),
    remove: (id: string) => setEvents((p) => p.filter((e) => e.id !== id)),
  };
}

export const sortEvents = (a: CalendarEvent, b: CalendarEvent) =>
  (a.date + (a.startTime ?? "")).localeCompare(b.date + (b.startTime ?? ""));

const fmt12 = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return `${((h! + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h! < 12 ? "AM" : "PM"}`;
};
export const formatTime = (e: CalendarEvent) =>
  e.startTime
    ? e.endTime
      ? `${fmt12(e.startTime)} – ${fmt12(e.endTime)}`
      : fmt12(e.startTime)
    : "All day";

export const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
