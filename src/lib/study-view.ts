import { useCallback, useState } from "react";

/**
 * The view modes of the study surface (material / saved notes workspace).
 *
 * Kept in its own module so the `StudySurface` component file only exports
 * components (which keeps React Fast Refresh happy), and so pages can remember
 * the reader's last choice without importing the whole surface.
 */
export type StudyView = "notes" | "transcript" | "material" | "split";

export function isStudyView(value: string | null): value is StudyView {
  return value === "notes" || value === "transcript" || value === "material" || value === "split";
}

/** A remembered view choice, so reopening a page keeps the reader's layout. */
export function useStoredStudyView(storageKey: string, fallback: StudyView) {
  const [view, setView] = useState<StudyView>(() => {
    if (typeof window === "undefined") return fallback;
    try {
      const stored = window.localStorage.getItem(storageKey);
      return isStudyView(stored) ? stored : fallback;
    } catch {
      return fallback;
    }
  });

  const update = useCallback(
    (next: StudyView) => {
      setView(next);
      try {
        window.localStorage.setItem(storageKey, next);
      } catch {
        /* storage unavailable — the choice just won't persist */
      }
    },
    [storageKey],
  );

  return [view, update] as const;
}
