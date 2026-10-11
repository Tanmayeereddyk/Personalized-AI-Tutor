import * as Dialog from "@radix-ui/react-dialog";
import { X, Sigma, Boxes, Database, Atom, Code2, BookOpen, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { CourseColor, CourseIcon } from "@/lib/types";

export const courseIcons: Record<CourseIcon, LucideIcon> = {
  sigma: Sigma, boxes: Boxes, database: Database, atom: Atom, code: Code2, book: BookOpen,
};
export const courseColorText: Record<CourseColor, string> = {
  mint: "text-course-mint", sky: "text-course-sky", amber: "text-course-amber",
  rose: "text-course-rose", violet: "text-course-violet", lime: "text-course-lime",
};
export const courseColorBg: Record<CourseColor, string> = {
  mint: "bg-course-mint", sky: "bg-course-sky", amber: "bg-course-amber",
  rose: "bg-course-rose", violet: "bg-course-violet", lime: "bg-course-lime",
};

export function CourseBadge({ icon, color, size = "md" }: { icon: CourseIcon; color: CourseColor; size?: "sm" | "md" | "lg" }) {
  const Icon = courseIcons[icon];
  const s = size === "sm" ? "h-6 w-6 rounded-md" : size === "lg" ? "h-14 w-14 rounded-2xl" : "h-10 w-10 rounded-xl";
  const i = size === "sm" ? "h-3.5 w-3.5" : size === "lg" ? "h-7 w-7" : "h-5 w-5";
  return (
    <span className={cn("relative inline-flex shrink-0 items-center justify-center bg-surface-2 border", s, courseColorText[color])}>
      <span className={cn("absolute inset-0 rounded-[inherit] opacity-15", courseColorBg[color])} />
      <Icon className={cn("relative", i)} />
    </span>
  );
}

export function masteryTone(v: number) {
  return v >= 75 ? "success" : v >= 50 ? "warning" : "destructive";
}

export function ProgressBar({ value, tone, className }: { value: number; tone?: "success" | "warning" | "destructive" | "primary"; className?: string }) {
  const t = tone ?? "primary";
  const bg = { success: "bg-success", warning: "bg-warning", destructive: "bg-destructive", primary: "bg-primary" }[t];
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-muted", className)}>
      <div className={cn("bar-grow h-full rounded-full", bg)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

export function Ring({ value, size = 140 }: { value: number; size?: number }) {
  const r = size / 2 - 10;
  const c = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} strokeWidth="10" className="fill-none stroke-muted" />
      <circle
        cx={size / 2} cy={size / 2} r={r} strokeWidth="10" strokeLinecap="round"
        className="fill-none stroke-primary transition-all duration-1000"
        strokeDasharray={c} strokeDashoffset={c * (1 - value / 100)}
      />
    </svg>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h2 className="text-2xl font-semibold tracking-tight">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function EmptyState({ icon: Icon, title, body, action }: { icon: LucideIcon; title: string; body: string; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center border-dashed px-6 py-16 text-center">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary text-primary"><Icon className="h-6 w-6" /></div>
      <h3 className="font-medium">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{body}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Modal({ open, onOpenChange, title, description, children, wide }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: string; children: ReactNode; wide?: boolean;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          className={cn(
            "card fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto bg-popover p-6 outline-none",
            "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
            wide ? "max-w-2xl" : "max-w-lg",
          )}
        >
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-lg font-semibold">{title}</Dialog.Title>
              {description && <Dialog.Description className="mt-1 text-sm text-muted-foreground">{description}</Dialog.Description>}
            </div>
            <Dialog.Close className="rounded-lg p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"><X className="h-4 w-4" /></Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Pill({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button" onClick={onClick}
      className={cn(
        "rounded-xl border px-3.5 py-2 text-sm transition-all",
        active ? "border-primary bg-primary/10 text-primary" : "bg-background text-muted-foreground hover:border-foreground/20 hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

export function Label({ children }: { children: ReactNode }) {
  return <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">{children}</div>;
}
