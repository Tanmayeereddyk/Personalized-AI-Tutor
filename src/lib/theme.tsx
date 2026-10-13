import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

/**
 * Application theming.
 *
 * Users can pick "light", "dark" or "system" (follow the OS). The choice is
 * persisted in localStorage (`studyai.theme`) and mirrored on <html> as
 * `.light` / `.dark`, which the CSS variables in src/styles.css respond to.
 *
 * To avoid a flash of the wrong theme, `__root.tsx` also ships a tiny inline
 * script in <head> that applies the stored (or system) theme before the first
 * paint. This provider stays in sync with that script and with OS changes.
 */

export type ThemePreference = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

const STORAGE_KEY = "studyai.theme";

function getStoredTheme(): ThemePreference | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {
    /* storage unavailable */
  }
  return null;
}

export function systemPrefersDark(): boolean {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

export function resolveTheme(pref: ThemePreference): ResolvedTheme {
  if (pref === "system") return systemPrefersDark() ? "dark" : "light";
  return pref;
}

/** Reflect a resolved theme on <html> so the CSS variables take effect. */
export function applyThemeClass(theme: ResolvedTheme): void {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.classList.toggle("light", theme === "light");
  try {
    root.style.colorScheme = theme;
  } catch {
    /* ignore */
  }
}

interface ThemeContextValue {
  theme: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: ThemePreference) => void;
}

const Ctx = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>(() => {
    // The inline head script uses the same rule: no stored value => system.
    if (typeof window === "undefined") return "system";
    return getStoredTheme() ?? "system";
  });
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => {
    if (typeof window === "undefined") return "dark";
    return resolveTheme(theme);
  });

  // Persist and apply whenever the preference changes.
  useEffect(() => {
    const resolved = resolveTheme(theme);
    setResolvedTheme(resolved);
    applyThemeClass(resolved);
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  // Follow the OS while in "system" mode.
  useEffect(() => {
    if (theme !== "system") return;
    let mql: MediaQueryList | undefined;
    try {
      mql = window.matchMedia("(prefers-color-scheme: dark)");
    } catch {
      return;
    }
    const onChange = () => {
      const resolved = resolveTheme(theme);
      setResolvedTheme(resolved);
      applyThemeClass(resolved);
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [theme]);

  const setTheme = useCallback((t: ThemePreference) => setThemeState(t), []);

  return (
    <Ctx.Provider value={{ theme, resolvedTheme, setTheme }}>{children}</Ctx.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const t = useContext(Ctx);
  if (!t) throw new Error("useTheme must be used inside ThemeProvider");
  return t;
}