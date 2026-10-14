import { CheckCircle2, FileText, XCircle } from "lucide-react";

import { MathText } from "@/components/math/MathText";
import { Ring } from "@/components/ui/kit";
import { scoreTone } from "@/components/practice/Builder";
import { labelForQuestionType, type QuizAttemptResult } from "@/lib/quiz";
import { cn } from "@/lib/utils";

/**
 * The read-only review of a graded attempt: the score ring, the attempt's
 * metadata and the per-question answers, correct answers and explanations.
 *
 * Shared by the live quiz runner (straight after submitting) and the Quiz
 * History view (when reopening a saved attempt) so both look and behave the
 * same. It is purely presentational — it never fetches or scores anything.
 */
export function QuizResultView({
  result,
  className,
}: {
  result: QuizAttemptResult;
  className?: string;
}) {
  const total = result.total;
  const pct = result.percentage;

  return (
    <div className={className}>
      <section className="card p-6 text-center">
        <div className="relative mx-auto h-[140px] w-[140px]">
          <Ring value={pct} />
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className={cn("text-3xl font-semibold", scoreTone(pct))}>{pct}%</span>
            <span className="text-xs text-muted-foreground">
              {result.score}/{total} correct
            </span>
          </div>
        </div>

        <p className="mt-4 text-sm text-muted-foreground">
          You scored {result.score} out of {total}.
        </p>
        {result.submittedAt ? (
          <p className="mt-1 text-xs text-muted-foreground">
            Submitted {new Date(result.submittedAt).toLocaleString()}
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap justify-center gap-1.5">
          <span className="chip">{result.difficulty}</span>
          {result.questionTypes.map((type) => (
            <span key={type} className="chip">
              {labelForQuestionType(type)}
            </span>
          ))}
          {result.timerMinutes != null ? (
            <span className="chip">{result.timerMinutes}-minute timer</span>
          ) : null}
        </div>
      </section>

      <h3 className="mb-3 mt-8 text-sm font-medium uppercase tracking-wider text-muted-foreground">
        Review
      </h3>
      <ul className="space-y-3">
        {result.results.map((item, i) => (
          <li
            key={item.id}
            className={cn(
              "card border-l-4 p-4",
              item.correct ? "border-l-success" : "border-l-destructive",
            )}
          >
            <div className="flex items-start gap-3">
              <span
                className={cn(
                  "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-medium",
                  item.correct
                    ? "bg-success/15 text-success"
                    : "bg-destructive/15 text-destructive",
                )}
              >
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  <MathText text={item.prompt} />
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <span className="chip">{labelForQuestionType(item.type)}</span>
                </div>

                <dl className="mt-3 space-y-1.5 text-sm">
                  <div className="flex gap-2">
                    <dt className="w-28 shrink-0 text-muted-foreground">Your answer</dt>
                    <dd
                      className={cn(
                        "min-w-0 break-words",
                        item.correct ? "text-success" : "text-destructive",
                      )}
                    >
                      {item.given.trim() ? (
                        <MathText text={item.given} />
                      ) : (
                        <span className="italic text-muted-foreground">Not answered</span>
                      )}
                    </dd>
                  </div>
                  {!item.correct ? (
                    <div className="flex gap-2">
                      <dt className="w-28 shrink-0 text-muted-foreground">Correct answer</dt>
                      <dd className="min-w-0 break-words">
                        <MathText text={item.correctAnswer} />
                      </dd>
                    </div>
                  ) : null}
                </dl>

                {item.explanation ? (
                  <p className="mt-3 rounded-lg bg-secondary/50 px-3 py-2 text-sm text-muted-foreground">
                    <MathText text={item.explanation} />
                  </p>
                ) : null}

                {item.source ? (
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <FileText className="h-3.5 w-3.5" />
                    Source: <span className="text-foreground">{item.source.materialName}</span> ·{" "}
                    {item.source.label}
                  </p>
                ) : null}
              </div>
              {item.correct ? (
                <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />
              ) : (
                <XCircle className="h-5 w-5 shrink-0 text-destructive" />
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
