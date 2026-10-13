/**
 * Frontend driver for the "Generate Notes" action.
 *
 * The heavy lifting — extraction, chunking, embedding, indexing, LLM writing and
 * saving — always happens in the backend. This module only *sequences* the
 * existing backend endpoints so one click performs any missing prerequisites
 * and the UI can report a real progress phase:
 *
 *   Extracting material… → Preparing content for search… →
 *   Generating notes… → Saving notes…
 *
 * The backend `notes/generate` endpoint is also self-sufficient (it runs the
 * same prerequisites server-side), so this is purely for progress reporting and
 * for *waiting* on an extraction an upload already started, rather than racing a
 * second one.
 */

import { api } from "./api";
import type { Note } from "./types";

export type NotesPhase = "extracting" | "indexing" | "generating" | "saving";

export const NOTES_PHASE_LABEL: Record<NotesPhase, string> = {
  extracting: "Extracting material…",
  indexing: "Preparing content for search…",
  generating: "Generating notes…",
  saving: "Saving notes…",
};

const POLL_INTERVAL_MS = 1500;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function emptyMessage(materialName: string, warnings: string[]): string {
  if (warnings.length > 0) return warnings.join(" ");
  return `${materialName} has no extractable text to turn into notes.`;
}

/**
 * Make one material extracted and indexed, reporting the phase as it goes.
 *
 * Throws with the real, actionable reason when the material has nothing that
 * can be turned into notes — the caller never falls back to mock content.
 */
export async function ensureMaterialReady(
  material: { id: string; name: string },
  onPhase: (phase: NotesPhase) => void,
): Promise<void> {
  const index = await api.materials.indexStatus(material.id);
  if (index.indexed) return;

  // A missing RAG store (the migration has not been run) is reported as status,
  // not a crash; surface its actionable message instead of indexing into it.
  if (index.message) throw new Error(index.message);

  if ((index.unitCount ?? 0) > 0) {
    // Extracted but not indexed yet: build the search index from the existing
    // content. No extraction needed.
    onPhase("indexing");
    await api.materials.index(material.id);
    return;
  }

  // Nothing extracted yet. If an upload's extraction is still running, wait for
  // it; otherwise (never extracted, or a failed/empty earlier run) start it now.
  let status = await api.extraction.status(material.id);
  if (status.status !== "processing") {
    onPhase("extracting");
    status = await api.extraction.start(material.id);
  }

  while (status.status === "processing") {
    onPhase(status.stage === "indexing" ? "indexing" : "extracting");
    await sleep(POLL_INTERVAL_MS);
    status = await api.extraction.status(material.id);
  }

  if (status.unitCount === 0) {
    throw new Error(emptyMessage(material.name, status.warnings));
  }

  // Extraction normally indexes automatically; make sure it really did.
  const after = await api.materials.indexStatus(material.id);
  if (!after.indexed && (after.unitCount ?? 0) > 0) {
    onPhase("indexing");
    await api.materials.index(material.id);
  }
}

/**
 * Run the whole Generate Notes pipeline for one material or a whole course,
 * reporting each phase. Returns the saved note.
 */
export async function generateNotesWithProgress(
  input: {
    courseId: string;
    materialId?: string | undefined;
    noteId?: string | undefined;
  },
  onPhase: (phase: NotesPhase) => void,
): Promise<Note> {
  const { courseId, materialId, noteId } = input;

  const materials = await api.materials.list(courseId);
  const scope = materialId
    ? materials.filter((material) => material.id === materialId)
    : materials;

  for (const material of scope) {
    await ensureMaterialReady(material, onPhase);
  }

  onPhase("generating");
  const note = await api.notes.generate(courseId, { materialId, noteId });
  onPhase("saving");
  return note;
}
