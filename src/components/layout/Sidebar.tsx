import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronsUpDown, CalendarDays, LayoutGrid, Library, LogOut, Monitor, Moon, Plus, Settings, Sparkles, Sun, User } from "lucide-react";
import { useStore } from "@/lib/store";
import { useAuth } from "@/lib/auth";
import { useTheme, type ThemePreference } from "@/lib/theme";
import { CourseBadge } from "@/components/ui/kit";
import { cn } from "@/lib/utils";

const nav = [
  { to: "/", label: "Dashboard", icon: LayoutGrid },
  { to: "/courses", label: "Courses", icon: Library },
  { to: "/calendar", label: "Calendar", icon: CalendarDays },
] as const;

const themeOptions: { value: ThemePreference; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Light", icon: Sun },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
];

/** compact = icon-only rail (tablet). */
export function Sidebar({ compact = false, onNavigate }: { compact?: boolean; onNavigate?: () => void }) {
  const { courses, user, setAddCourseOpen } = useStore();
  const { logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const isActive = (to: string) => (to === "/" ? path === "/" : path === to);

  const displayName = user.name.trim() || "Student";
  const initial = (displayName[0] ?? "S").toUpperCase();

  const item = (active: boolean) =>
    cn(
      "group flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm transition-colors",
      compact && "justify-center px-0",
      active ? "bg-secondary text-foreground" : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
    );

  return (
    <div className="flex h-full flex-col bg-sidebar">
      <div className={cn("flex items-center gap-2.5 px-4 py-5", compact && "justify-center px-0")}>
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-[0_0_24px_-4px] shadow-primary/60">
          <Sparkles className="h-4 w-4" />
        </span>
        {!compact && <span className="text-[15px] font-semibold tracking-tight">Lumio</span>}
      </div>

      <nav className="space-y-0.5 px-3">
        {nav.map((n) => (
          <Link key={n.to} to={n.to} onClick={onNavigate} className={item(isActive(n.to))} title={n.label}>
            <n.icon className="h-4 w-4 shrink-0" />
            {!compact && n.label}
          </Link>
        ))}
      </nav>

      <div className="mt-7 flex-1 overflow-y-auto px-3">
        {!compact && <div className="mb-2 px-2.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">Your courses</div>}
        <div className="space-y-0.5">
          {courses.map((c) => (
            <Link
              key={c.id} to="/courses/$courseId" params={{ courseId: c.id }} onClick={onNavigate} title={c.name}
              className={item(path.startsWith(`/courses/${c.id}`))}
            >
              <CourseBadge icon={c.icon} color={c.color} size="sm" />
              {!compact && <span className="truncate">{c.name}</span>}
            </Link>
          ))}
        </div>
        <button onClick={() => { setAddCourseOpen(true); onNavigate?.(); }} className={cn(item(false), "mt-1 w-full")} title="Add course">
          <span className="flex h-6 w-6 items-center justify-center rounded-md border border-dashed"><Plus className="h-3.5 w-3.5" /></span>
          {!compact && "Add Course"}
        </button>
      </div>

      <div className="space-y-0.5 border-t p-3">
        <Link to="/settings" onClick={onNavigate} className={item(isActive("/settings"))} title="Settings">
          <Settings className="h-4 w-4" />
          {!compact && "Settings"}
        </Link>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger className={cn(item(false), "w-full outline-none")}>
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-course-mint to-course-sky text-xs font-semibold text-primary-foreground">
              {initial}
            </span>
            {!compact && (
              <>
                <span className="flex-1 text-left leading-tight">
                  <span className="block truncate text-sm text-foreground">{displayName}</span>
                  <span className="block text-xs text-muted-foreground">{user.role}</span>
                </span>
                <ChevronsUpDown className="h-3.5 w-3.5" />
              </>
            )}
          </DropdownMenu.Trigger>
          <DropdownMenu.Portal>
            <DropdownMenu.Content side="top" align="start" sideOffset={8} className="card z-50 w-56 bg-popover p-1.5 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95">
              <div className="px-2.5 py-2">
                <div className="truncate text-sm font-medium">{displayName}</div>
                <div className="truncate text-xs text-muted-foreground">{user.email || user.role}</div>
              </div>
              <DropdownMenu.Separator className="my-1 h-px bg-border" />
              <DropdownMenu.Item asChild>
                <Link to="/profile" onClick={onNavigate} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-muted-foreground outline-none data-[highlighted]:bg-secondary data-[highlighted]:text-foreground">
                  <User className="h-4 w-4" />Profile
                </Link>
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="my-1 h-px bg-border" />
              <DropdownMenu.Label className="px-2.5 pb-1 pt-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Theme
              </DropdownMenu.Label>
              <DropdownMenu.RadioGroup value={theme} onValueChange={(v) => setTheme(v as ThemePreference)}>
                {themeOptions.map((o) => (
                  <DropdownMenu.RadioItem
                    key={o.value}
                    value={o.value}
                    className="relative flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 pl-9 text-sm text-muted-foreground outline-none data-[highlighted]:bg-secondary data-[highlighted]:text-foreground data-[state=checked]:text-foreground"
                  >
                    <o.icon className="absolute left-2.5 h-4 w-4" />
                    {o.label}
                    <DropdownMenu.ItemIndicator className="absolute right-2.5">
                      <Check className="h-4 w-4 text-primary" />
                    </DropdownMenu.ItemIndicator>
                  </DropdownMenu.RadioItem>
                ))}
              </DropdownMenu.RadioGroup>
              <DropdownMenu.Separator className="my-1 h-px bg-border" />
              <DropdownMenu.Item onSelect={() => { void logout().finally(() => { onNavigate?.(); navigate({ to: "/login" }); }); }} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-destructive outline-none data-[highlighted]:bg-secondary">
                <LogOut className="h-4 w-4" />Log out
              </DropdownMenu.Item>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </div>
    </div>
  );
}