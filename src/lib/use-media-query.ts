import { useSyncExternalStore } from "react";

const subscribe = (query: string) => (callback: () => void) => {
  const mql = window.matchMedia(query);
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
};

const getSnapshot = (query: string) => () => window.matchMedia(query).matches;

/**
 * SSR-safe MediaQuery hook backed by useSyncExternalStore.
 *
 * On the server (or before hydration) it returns the default guess, so the
 * layout doesn't flash when the client takes over.
 */
export function useMediaQuery(query: string, initial = false): boolean {
  return useSyncExternalStore(subscribe(query), getSnapshot(query), () => initial);
}