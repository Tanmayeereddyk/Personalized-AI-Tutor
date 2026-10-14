import { Fragment } from "react";

import { MathExpression } from "@/components/math/Math";
import { splitInlineMath } from "@/lib/math";

/**
 * Render a plain string that may contain inline LaTeX (`$…$`, `\(…\)`) as text
 * with typeset math. Used on surfaces that are not full Markdown — quiz
 * questions, flashcard faces — so equations still render instead of showing as
 * raw markup. Non-math text is passed through unchanged.
 */
export function MathText({ text, className }: { text: string; className?: string }) {
  const parts = splitInlineMath(text);
  return (
    <span className={className}>
      {parts.map((part, index) =>
        part.type === "math" ? (
          <MathExpression key={index} latex={part.latex} display={part.display} />
        ) : (
          <Fragment key={index}>{part.value}</Fragment>
        ),
      )}
    </span>
  );
}
