import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronRight, Monitor, Moon, Sun } from "lucide-react";
import { useStore } from "@/lib/store";
import { useTheme, type ThemePreference } from "@/lib/theme";
import { Label, Pill } from "@/components/ui/kit";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — StudyAI" },
      { name: "description", content: "Manage your StudyAI preferences." },
      { property: "og:title", content: "Settings — StudyAI" },
      { property: "og:description", content: "Manage your StudyAI preferences." },
    ],
  }),
  component: Settings,
});

const GOAL_KEY = "studyai.studyGoal";
const GOALS = ["15 min", "30 min", "45 min", "60 min", "90 min"];

function readStoredGoal(): string {
  try {
    const stored = localStorage.getItem(GOAL_KEY);
    if (stored && GOALS.includes(stored)) return stored;
  } catch {
    /* storage unavailable */
  }
  return "45 min";
}

const themeOptions: { value: ThemePreference; label: string; icon: typeof Sun; hint: string }[] = [
  { value: "light", label: "Light", icon: Sun, hint: "Always use the light theme." },
  { value: "dark", label: "Dark", icon: Moon, hint: "Always use the dark theme." },
  { value: "system", label: "System", icon: Monitor, hint: "Follow your device setting." },
];

function Settings() {
  const { user } = useStore();
  const { theme, setTheme } = useTheme();
  const [goal, setGoal] = useState<string>(readStoredGoal);

  const displayName = user.name.trim() || "Student";
  const initial = (displayName[0] ?? "S").toUpperCase();

  const chooseGoal = (g: string) => {
    setGoal(g);
    try {
      localStorage.setItem(GOAL_KEY, g);
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="max-w-2xl space-y-8">
      <h1 className="mb-0 font-display text-4xl tracking-tight">Settings</h1>

      {/* Profile summary — the full editing interface lives on /profile. */}
      <section className="card space-y-4 p-6">
        <div className="flex items-center gap-4">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-course-mint to-course-sky text-xl font-semibold text-primary-foreground">
            {initial}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium">{displayName}</div>
            <div className="truncate text-sm text-muted-foreground">{user.email}</div>
          </div>
          <Link
            to="/profile"
            className="btn btn-ghost shrink-0"
            aria-label="Edit your profile details"
          >
            Edit profile <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
      </section>

      <section className="card space-y-6 p-6">
        <div>
          <Label>Appearance</Label>
          <div className="grid gap-3 sm:grid-cols-3">
            {themeOptions.map((o) => {
              const active = theme === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => setTheme(o.value)}
                  aria-pressed={active}
                  className={cn(
                    "flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition-all",
                    active
                      ? "border-primary bg-primary/10 text-primary"
                      : "bg-background text-muted-foreground hover:border-foreground/20 hover:text-foreground",
                  )}
                >
                  <o.icon className="h-5 w-5" />
                  <span className="flex flex-col gap-0.5">
                    <span className="text-sm font-medium">{o.label}</span>
                    <span className="text-xs opacity-80">{o.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section className="card space-y-6 p-6">
        <div>
          <Label>Daily study goal</Label>
          <div className="flex flex-wrap gap-2">
            {GOALS.map((g) => (
              <Pill key={g} active={goal === g} onClick={() => chooseGoal(g)}>
                {g}
              </Pill>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Your daily study goal is used to keep your dashboard on track.
          </p>
        </div>
      </section>
    </div>
  );
}