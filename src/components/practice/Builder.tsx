import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { Label, Pill } from "@/components/ui/kit";
import { cn } from "@/lib/utils";

export function toggle<T>(list: T[], v: T) {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

export function CheckGrid({ options, value, onChange }: { options: string[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {options.map((o) => {
        const on = value.includes(o);
        return (
          <button key={o} type="button" onClick={() => onChange(toggle(value, o))}
            className={cn("flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition",
              on ? "border-primary/60 bg-primary/10" : "bg-background hover:border-foreground/20")}>
            <span className={cn("flex h-4 w-4 items-center justify-center rounded border", on ? "border-primary bg-primary text-primary-foreground" : "border-foreground/30")}>
              {on && <Check className="h-3 w-3" />}
            </span>
            {o}
          </button>
        );
      })}
    </div>
  );
}

export function PillGroup<T extends string | number>({ options, value, onChange, format }: {
  options: readonly T[]; value: T; onChange: (v: T) => void; format?: (v: T) => ReactNode;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => <Pill key={String(o)} active={value === o} onClick={() => onChange(o)}>{format ? format(o) : o}</Pill>)}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div><Label>{label}</Label>{children}</div>;
}

export function scoreTone(pct: number) {
  return pct >= 80 ? "text-success" : pct >= 60 ? "text-warning" : "text-destructive";
}
export function scoreBorder(pct: number) {
  return pct >= 80 ? "border-l-success" : pct >= 60 ? "border-l-warning" : "border-l-destructive";
}
