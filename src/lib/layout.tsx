import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

/**
 * App-shell layout state shared between the sidebar and the page content.
 *
 * - `collapsed` folds the left navigation down to an icon-only rail and is
 *   remembered across reloads.
 * - `focus` is the study screens' "full screen" mode: the workspace is shown
 *   as a full-page overlay (with its own close control) instead of inline.
 *
 * The provider lives in AppShell. A fallback value is used when the hook is
 * read outside the provider (e.g. a component rendered in isolation in a
 * test), so consuming components never throw.
 */
export interface LayoutState {
  collapsed: boolean;
  setCollapsed: (value: boolean) => void;
  toggleCollapsed: () => void;
  focus: boolean;
  setFocus: (value: boolean) => void;
  toggleFocus: () => void;
}

const FALLBACK: LayoutState = {
  collapsed: false,
  setCollapsed: () => {},
  toggleCollapsed: () => {},
  focus: false,
  setFocus: () => {},
  toggleFocus: () => {},
};

const Ctx = createContext<LayoutState>(FALLBACK);

const SIDEBAR_KEY = "studyai.layout.sidebarCollapsed";

function readCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(SIDEBAR_KEY) === "1";
  } catch {
    return false;
  }
}

export function LayoutProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsedState] = useState(readCollapsed);
  const [focus, setFocus] = useState(false);

  const setCollapsed = useCallback((value: boolean) => {
    setCollapsedState(value);
    try {
      window.localStorage.setItem(SIDEBAR_KEY, value ? "1" : "0");
    } catch {
      /* storage unavailable — the choice just won't persist */
    }
  }, []);

  const value = useMemo<LayoutState>(
    () => ({
      collapsed,
      setCollapsed,
      toggleCollapsed: () => setCollapsed(!collapsed),
      focus,
      setFocus,
      toggleFocus: () => setFocus((current) => !current),
    }),
    [collapsed, setCollapsed, focus],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLayout(): LayoutState {
  return useContext(Ctx);
}
