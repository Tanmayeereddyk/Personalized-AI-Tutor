import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Clock,
  File,
  FileText,
  Loader2,
  Presentation,
  RefreshCw,
  Search,
  Sparkles,
  Video,
} from "lucide-react";

import { EmptyState, Modal } from "@/components/ui/kit";
import { CheckGrid, Field, PillGroup } from "@/components/practice/Builder";
import { Switch } from "@/components/ui/switch";
import { useMaterials } from "@/lib/queries";
import type { Material, MaterialType } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  DEFAULT_QUIZ_CONFIG,
  QUIZ_DIFFICULTIES,
  QUIZ_QUESTION_COUNT_OPTIONS,
  QUIZ_QUESTION_TYPES,
  QUIZ_TIMER_OPTIONS,
  type QuizConfig,
  type QuizQuestionType,
} from "@/lib/quiz-mock";

const MATERIAL_ICONS: Record<MaterialType, typeof FileText> = {
  pdf: FileText,
  ppt: Presentation,
  video: Video,
  doc: File,
};

const MATERIAL_TYPE_LABELS: Record<MaterialType, string> = {
  pdf: "PDF",
  ppt: "Slides",
  video: "Video",
  doc: "Document",
};

const TYPE_FILTERS = ["all", "pdf", "ppt", "video", "doc"] as const;
type MaterialFilter = (typeof TYPE_FILTERS)[number];

const FILTER_LABELS: Record<MaterialFilter, string> = {
  all: "All",
  pdf: "PDF",
  ppt: "Slides",
  video: "Video",
  doc: "Document",
};

const COUNT_OPTIONS: number[] = [...QUIZ_QUESTION_COUNT_OPTIONS];
const TIMER_OPTIONS: number[] = [...QUIZ_TIMER_OPTIONS];

export interface QuizStartInput {
  material: Material;
  config: QuizConfig;
}

interface QuizBuilderProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  courseId: string;
  onStart: (input: QuizStartInput) => void;
}

/**
 * Two-step quiz setup: pick a saved material, then choose the quiz settings.
 * Settings are stored in local state only — nothing is generated server-side.
 */
export function QuizBuilder({ open, onOpenChange, courseId, onStart }: QuizBuilderProps) {
  const materials = useMaterials(courseId);
  const list = materials.data ?? [];

  const [step, setStep] = useState<"material" | "config">("material");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<MaterialFilter>("all");

  const [questionCount, setQuestionCount] = useState(DEFAULT_QUIZ_CONFIG.questionCount);
  const [difficulty, setDifficulty] = useState(DEFAULT_QUIZ_CONFIG.difficulty);
  const [types, setTypes] = useState<QuizQuestionType[]>(DEFAULT_QUIZ_CONFIG.questionTypes);
  const [timerEnabled, setTimerEnabled] = useState(false);
  const [timerMinutes, setTimerMinutes] = useState<number>(10);

  const selected = useMemo(
    () => list.find((m) => m.id === selectedId) ?? null,
    [list, selectedId],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return list.filter(
      (m) => (filter === "all" || m.type === filter) && (!q || m.name.toLowerCase().includes(q)),
    );
  }, [list, search, filter]);

  const reset = () => {
    setStep("material");
    setSelectedId(null);
    setSearch("");
    setFilter("all");
    setQuestionCount(DEFAULT_QUIZ_CONFIG.questionCount);
    setDifficulty(DEFAULT_QUIZ_CONFIG.difficulty);
    setTypes(DEFAULT_QUIZ_CONFIG.questionTypes);
    setTimerEnabled(false);
    setTimerMinutes(10);
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) reset();
    onOpenChange(next);
  };

  const toggleType = (next: string[]) => {
    setTypes(
      QUIZ_QUESTION_TYPES.filter((t) => next.includes(t.label)).map((t) => t.value),
    );
  };

  const generate = () => {
    if (!selected) return;
    onStart({
      material: selected,
      config: {
        questionCount,
        difficulty,
        questionTypes: types,
        timerMinutes: timerEnabled ? timerMinutes : null,
      },
    });
  };

  const readyMaterials = materials.isLoading || materials.isError ? false : list.length > 0;
  const canGenerate = !!selected && types.length > 0;

  return (
    <Modal
      open={open}
      onOpenChange={handleOpenChange}
      size="xl"
      title={step === "material" ? "Choose a material" : "Configure your quiz"}
      description={
        step === "material"
          ? "Pick the saved material the quiz should cover."
          : selected
            ? `Questions for “${selected.name}”.`
            : "Choose how you want the quiz to look."
      }
    >
      {step === "material" ? (
        <div>
          {/* Search + type filters */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                className="field pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search materials…"
                aria-label="Search materials by name"
              />
            </div>
          </div>
          <div className="mt-3">
            <PillGroup<MaterialFilter>
              options={TYPE_FILTERS}
              value={filter}
              onChange={setFilter}
              format={(v) => FILTER_LABELS[v]}
            />
          </div>

          {/* States */}
          <div className="mt-5">
            {materials.isLoading ? (
              <div className="card flex items-center justify-center gap-2 border-dashed px-6 py-14 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading your materials…
              </div>
            ) : materials.isError ? (
              <div className="card px-6 py-12 text-center">
                <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
                  <AlertTriangle className="h-5 w-5" />
                </div>
                <p className="font-medium">Couldn’t load your materials</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {(materials.error as Error)?.message ?? "Please try again."}
                </p>
                <button className="btn btn-ghost mt-5" onClick={() => void materials.refetch()}>
                  <RefreshCw className="h-4 w-4" />
                  Try again
                </button>
              </div>
            ) : !readyMaterials ? (
              <EmptyState
                icon={FileText}
                title="No saved materials yet"
                body="Upload a PDF, slide deck or lecture video in Materials, then come back to build a quiz from it."
              />
            ) : filtered.length === 0 ? (
              <div className="card flex flex-col items-center border-dashed px-6 py-12 text-center">
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl bg-secondary text-muted-foreground">
                  <Search className="h-5 w-5" />
                </div>
                <p className="font-medium">No materials match</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Try a different search term or file type.
                </p>
                <button
                  className="btn btn-ghost mt-5"
                  onClick={() => {
                    setSearch("");
                    setFilter("all");
                  }}
                >
                  Clear filters
                </button>
              </div>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2" role="list">
                {filtered.map((m) => {
                  const Icon = MATERIAL_ICONS[m.type] ?? File;
                  const isSelected = m.id === selectedId;
                  return (
                    <li key={m.id}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(m.id)}
                        aria-pressed={isSelected}
                        className={cn(
                          "group relative flex w-full items-start gap-3 rounded-2xl border p-4 text-left transition outline-none",
                          "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                          isSelected
                            ? "border-primary bg-primary/10 shadow-[0_0_0_1px_var(--color-primary)]"
                            : "bg-background hover:border-foreground/20 hover:bg-accent/40",
                        )}
                      >
                        <span
                          className={cn(
                            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border",
                            isSelected ? "border-primary/40 bg-primary/15 text-primary" : "bg-surface-2 text-muted-foreground",
                          )}
                        >
                          <Icon className="h-5 w-5" />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{m.name}</span>
                          <span className="mt-1.5 flex flex-wrap gap-1.5">
                            <span className="chip">{MATERIAL_TYPE_LABELS[m.type] ?? m.kind}</span>
                            {m.added ? <span className="chip">{m.added}</span> : null}
                            {m.status !== "ready" ? (
                              <span className="chip text-warning">
                                {m.status === "processing" ? "Processing…" : "Needs attention"}
                              </span>
                            ) : null}
                          </span>
                        </span>
                        <span
                          className={cn(
                            "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition",
                            isSelected
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-foreground/25 text-transparent",
                          )}
                          aria-hidden="true"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {/* Footer */}
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <p className="min-w-0 text-sm text-muted-foreground">
              {selected ? (
                <>
                  Selected: <span className="text-foreground">{selected.name}</span>
                </>
              ) : (
                "Select a material to continue."
              )}
            </p>
            <div className="flex items-center gap-2">
              <button className="btn btn-ghost" onClick={() => handleOpenChange(false)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={() => setStep("config")}
                disabled={!selected}
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          {selected ? (
            <div className="flex items-center gap-3 rounded-2xl border bg-background p-3">
              {(() => {
                const Icon = MATERIAL_ICONS[selected.type] ?? File;
                return (
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-muted-foreground">
                    <Icon className="h-4 w-4" />
                  </span>
                );
              })()}
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{selected.name}</div>
                <div className="mt-1 flex flex-wrap gap-1.5">
                  <span className="chip">{MATERIAL_TYPE_LABELS[selected.type] ?? selected.kind}</span>
                  {selected.added ? <span className="chip">{selected.added}</span> : null}
                </div>
              </div>
              <button className="btn btn-ghost" onClick={() => setStep("material")}>
                <ArrowLeft className="h-4 w-4" />
                Change
              </button>
            </div>
          ) : null}

          <Field label="Number of questions">
            <PillGroup<number>
              options={COUNT_OPTIONS}
              value={questionCount}
              onChange={setQuestionCount}
              format={(v) => `${v}`}
            />
          </Field>

          <Field label="Difficulty">
            <PillGroup
              options={QUIZ_DIFFICULTIES}
              value={difficulty}
              onChange={setDifficulty}
            />
          </Field>

          <Field label="Question types">
            <CheckGrid
              options={QUIZ_QUESTION_TYPES.map((t) => t.label)}
              value={QUIZ_QUESTION_TYPES.filter((t) => types.includes(t.value)).map((t) => t.label)}
              onChange={toggleType}
            />
            {types.length === 0 ? (
              <p className="mt-2 text-xs text-destructive">
                Choose at least one question type.
              </p>
            ) : null}
          </Field>

          {/* Optional timer */}
          <div className="rounded-2xl border bg-background p-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <label htmlFor="quiz-timer-enabled" className="flex items-center gap-2 text-sm font-medium">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  Enable timer
                </label>
                <p className="mt-1 text-xs text-muted-foreground">
                  Off by default — take the quiz with no time limit.
                </p>
              </div>
              <Switch
                id="quiz-timer-enabled"
                checked={timerEnabled}
                onCheckedChange={setTimerEnabled}
                aria-label="Enable quiz timer"
              />
            </div>

            {timerEnabled ? (
              <div className="mt-4 border-t pt-4">
                <Field label="Time limit">
                  <PillGroup<number>
                    options={TIMER_OPTIONS}
                    value={timerMinutes}
                    onChange={setTimerMinutes}
                    format={(v) => `${v} min`}
                  />
                </Field>
                <p className="mt-2 text-xs text-muted-foreground" role="status">
                  Time limit:{" "}
                  <span className="font-medium text-foreground">{timerMinutes} minutes</span>{" "}
                  ({timerMinutes}:00). The countdown starts when the quiz opens.
                </p>
              </div>
            ) : null}
          </div>

          {/* Summary + generate */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <p className="text-xs text-muted-foreground">
              {questionCount} questions · {difficulty} ·{" "}
              {types.length === 1 ? "1 type" : `${types.length} types`} ·{" "}
              {timerEnabled ? `${timerMinutes}-minute timer` : "no timer"}
            </p>
            <div className="flex items-center gap-2">
              <button className="btn btn-ghost" onClick={() => setStep("material")}>
                Back
              </button>
              <button className="btn btn-primary" onClick={generate} disabled={!canGenerate}>
                <Sparkles className="h-4 w-4" />
                Generate Quiz
              </button>
            </div>
          </div>

          <p className="flex items-start gap-2 rounded-xl border border-dashed bg-secondary/40 px-3 py-2.5 text-xs text-muted-foreground">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
            Demo mode: questions are hand-written placeholders. Quiz generation is not
            connected to AI yet, so nothing here is graded or saved.
          </p>
        </div>
      )}
    </Modal>
  );
}
