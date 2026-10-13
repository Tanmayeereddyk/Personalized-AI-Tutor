import type { Citation } from "./types";

/**
 * Human-readable label for a citation. Every citation the backend returns points
 * at a real chunk or saved note, so this only formats what already exists.
 */
export function citationText(citation: Citation): string {
  if (citation.kind === "note") {
    return `${citation.materialName ?? "Saved note"} · note`;
  }
  const name = citation.materialName ?? "Material";
  if (citation.label) return `${name} · ${citation.label}`;
  return name;
}

/** A stable React key / dedupe key for a citation. */
export function citationKey(citation: Citation): string {
  return [
    citation.kind,
    citation.materialId ?? "",
    citation.noteId ?? "",
    citation.label ?? "",
  ].join("|");
}

/** Deduplicate citations that point at the same source location. */
export function uniqueCitations(citations: Citation[]): Citation[] {
  const seen = new Set<string>();
  const out: Citation[] = [];
  for (const citation of citations) {
    const key = citationKey(citation);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(citation);
  }
  return out;
}
