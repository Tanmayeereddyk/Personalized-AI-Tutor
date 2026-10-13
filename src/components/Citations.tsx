import { File, FileText, NotebookPen, Presentation, Video } from "lucide-react";

import { citationKey, citationText, uniqueCitations } from "@/lib/citations";
import type { Citation, CitationKind } from "@/lib/types";

const icons: Record<CitationKind, typeof FileText> = {
  pdf: FileText,
  slides: Presentation,
  video: Video,
  note: NotebookPen,
  material: File,
};

/**
 * Renders the source references returned by the RAG pipeline. Every citation
 * points at a real chunk or saved note, so nothing here is fabricated.
 */
export function CitationChips({ citations }: { citations: Citation[] }) {
  const list = uniqueCitations(citations);
  if (list.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {list.map((citation) => {
        const Icon = icons[citation.kind] ?? File;
        return (
          <span
            key={citationKey(citation)}
            className="chip"
            title={citation.snippet ?? citationText(citation)}
          >
            <Icon className="h-3 w-3" />
            {citationText(citation)}
            {citation.materialDeleted ? " · source deleted" : ""}
          </span>
        );
      })}
    </div>
  );
}
