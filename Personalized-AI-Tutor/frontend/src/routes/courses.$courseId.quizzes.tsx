import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ListChecks, Plus, Sparkles, Loader2, Check, X } from "lucide-react";
import { getQuizzes, getTopics } from "@/lib/store";
import type { Difficulty } from "@/lib/types";
import { EmptyState, Modal, PageHeader } from "@/components/ui/kit";
import { CheckGrid, Field, PillGroup, scoreBorder, scoreTone } from "@/components/practice/Builder";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/courses/$courseId/quizzes")({
  component: Quizzes,
});

const mockQuestions = [
  {
    q: "What is the average-case time complexity of Quick Sort?",
    options: ["O(n)", "O(n log n)", "O(n²)", "O(log n)"],
    answer: 1,
  },
  {
    q: "Which recurrence describes Merge Sort?",
    options: ["T(n)=T(n-1)+n", "T(n)=2T(n/2)+n", "T(n)=T(n/2)+1", "T(n)=2T(n-1)+1"],
    answer: 1,
  },
  {
    q: "Which pivot choice avoids Quick Sort's worst case on sorted input?",
    options: ["First element", "Last element", "Random element", "Smallest element"],
    answer: 2,
  },
];

function Quizzes() {
  const { courseId } = Route.useParams();
  const quizzes = getQuizzes(courseId);
  const topics = getTopics(courseId).map((t) => t.name);
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<"config" | "loading" | "quiz">("config");
  const [sel, setSel] = useState<string[]>([]);
  const [diff, setDiff] = useState<Difficulty>("Medium");
  const [types, setTypes] = useState<string[]>(["Multiple Choice"]);
  const [count, setCount] = useState(10);
  const [answers, setAnswers] = useState<Record<number, number>>({});

  const start = () => {
    setOpen(true);
    setStage("config");
    setAnswers({});
  };
  const generate = () => {
    setStage("loading");
    setTimeout(() => setStage("quiz"), 1800);
  };

  return (
    <div>
      <PageHeader
        title="Quizzes"
        subtitle="Short, topic-level practice to sharpen weak spots."
        action={
          <button className="btn btn-primary" onClick={start}>
            <Plus className="h-4 w-4" />
            Create Quiz
          </button>
        }
      />

      {quizzes.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title="No quizzes attempted yet."
          body="Generate a quiz from your course topics to check your understanding."
          action={
            <button className="btn btn-primary" onClick={start}>
              Create Your First Quiz
            </button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {quizzes.map((q, i) => {
            const pct = Math.round((q.score / q.total) * 100);
            return (
              <div
                key={q.id}
                className={cn("card lift fade-up flex flex-col border-l-2 p-5", scoreBorder(pct))}
                style={{ animationDelay: `${i * 50}ms` }}
              >
                <h3 className="font-medium">{q.name}</h3>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <span className="chip">{q.topic}</span>
                  <span className="chip">{q.difficulty}</span>
                  <span className="chip">{q.total} Qs</span>
                </div>
                <div className="mt-6 flex items-end justify-between">
                  <div>
                    <div className="text-xs text-muted-foreground">Score</div>
                    <div className="font-mono text-2xl font-semibold">
                      {q.score}
                      <span className="text-muted-foreground"> / {q.total}</span>
                    </div>
                  </div>
                  <div className={cn("font-mono text-3xl font-semibold", scoreTone(pct))}>
                    {pct}%
                  </div>
                </div>
                <div className="mt-4 text-xs text-muted-foreground">Attempted {q.date}</div>
                <button className="btn btn-ghost mt-5 self-start">Review Answers</button>
              </div>
            );
          })}
        </div>
      )}

      <Modal
        open={open}
        onOpenChange={setOpen}
        title={stage === "quiz" ? "Your generated quiz" : "Create a Quiz"}
        wide
        description={
          stage === "quiz"
            ? `${diff} · ${sel.join(", ") || "All topics"}`
            : "Questions are generated from this course's materials."
        }
      >
        {stage === "config" && (
          <div className="space-y-6">
            <Field label="Choose topics">
              <CheckGrid options={topics} value={sel} onChange={setSel} />
            </Field>
            <Field label="Difficulty">
              <PillGroup
                options={["Easy", "Medium", "Hard", "Mixed"] as const}
                value={diff}
                onChange={setDiff}
              />
            </Field>
            <Field label="Question types">
              <CheckGrid
                options={["Multiple Choice", "Short Answer", "Numerical"]}
                value={types}
                onChange={setTypes}
              />
            </Field>
            <Field label="Number of questions">
              <PillGroup options={[5, 10, 15, 20] as const} value={count} onChange={setCount} />
            </Field>
            <div className="flex justify-end gap-2">
              <button className="btn btn-ghost" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={!sel.length || !types.length}
                onClick={generate}
              >
                <Sparkles className="h-4 w-4" />
                Generate Quiz
              </button>
            </div>
          </div>
        )}
        {stage === "loading" && <Generating label={`Generating ${count} questions…`} />}
        {stage === "quiz" && (
          <div className="space-y-5">
            {mockQuestions.map((mq, qi) => (
              <div key={qi} className="rounded-xl border bg-background p-4">
                <div className="text-sm font-medium">
                  <span className="mr-2 font-mono text-muted-foreground">{qi + 1}.</span>
                  {mq.q}
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {mq.options.map((o, oi) => {
                    const picked = answers[qi];
                    const done = picked !== undefined;
                    const correct = oi === mq.answer;
                    return (
                      <button
                        key={oi}
                        disabled={done}
                        onClick={() => setAnswers((a) => ({ ...a, [qi]: oi }))}
                        className={cn(
                          "flex items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition",
                          !done && "hover:border-foreground/30",
                          done && correct && "border-success/60 bg-success/10",
                          done &&
                            picked === oi &&
                            !correct &&
                            "border-destructive/60 bg-destructive/10",
                        )}
                      >
                        <span className="font-mono">{o}</span>
                        {done && correct && <Check className="h-4 w-4 text-success" />}
                        {done && picked === oi && !correct && (
                          <X className="h-4 w-4 text-destructive" />
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
            <p className="text-center text-xs text-muted-foreground">
              Showing 3 of {count} sample questions
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}

export function Generating({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center py-14">
      <div className="relative">
        <span className="absolute inset-0 animate-ping rounded-full bg-primary/20" />
        <span className="relative flex h-14 w-14 items-center justify-center rounded-full bg-primary/15 text-primary">
          <Loader2 className="h-6 w-6 animate-spin" />
        </span>
      </div>
      <p className="mt-5 text-sm text-muted-foreground">{label}</p>
    </div>
  );
}
