import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "./api";
import { useAuth } from "./auth";
import type { CalendarEvent } from "./types";

/**
 * Calendar events are personal data stored in Supabase. This hook loads
 * them for the signed-in user and refreshes after every mutation, so the
 * calendar always reflects what is actually saved on the server.
 */
export function useEvents() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["events", user?.id],
    queryFn: () => api.events.list(),
    enabled: !!user,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["events", user?.id] });

  const create = useMutation({
    mutationFn: (event: Omit<CalendarEvent, "id">) => api.events.create(event),
    onSuccess: invalidate,
  });
  const edit = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<CalendarEvent> }) =>
      api.events.update(id, patch),
    onSuccess: invalidate,
  });
  const destroy = useMutation({
    mutationFn: (id: string) => api.events.remove(id),
    onSuccess: invalidate,
  });

  return {
    events: query.data ?? [],
    loading: query.isLoading,
    error: query.isError ? (query.error as Error).message : null,
    add: (event: Omit<CalendarEvent, "id">) => create.mutateAsync(event),
    update: (id: string, patch: Partial<CalendarEvent>) => edit.mutateAsync({ id, patch }),
    remove: (id: string) => destroy.mutateAsync(id),
  };
}

export const sortEvents = (a: CalendarEvent, b: CalendarEvent) =>
  (a.date + (a.startTime ?? "")).localeCompare(b.date + (b.startTime ?? ""));

const fmt12 = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return `${((h! + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h! < 12 ? "AM" : "PM"}`;
};
export const formatTime = (e: CalendarEvent) =>
  e.startTime ? (e.endTime ? `${fmt12(e.startTime)} – ${fmt12(e.endTime)}` : fmt12(e.startTime)) : "All day";

export const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
