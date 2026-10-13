/**
 * Helpers for the audio transcript produced by local Whisper transcription.
 *
 * Transcript segments are stored as ordinary ``extracted_units`` rows
 * (content_type "text") whose provenance marks them as speech: the
 * extraction method (``whisper_transcription``) mirrored by the metadata
 * written at extraction time. These helpers keep that knowledge in one place
 * so the player, the extraction-results view and any future notes/retrieval
 * pipeline all agree on what a transcript segment is.
 */

import type { ExtractedUnit } from "./types";

/** ``extraction_method`` stamped on every audio-transcript unit. */
export const TRANSCRIPT_METHOD = "whisper_transcription";

/**
 * True for a unit that came from the audio transcript rather than a page,
 * slide or frame. Falls back to the metadata marker so units written before
 * the method was standardised are still recognised.
 */
export function isTranscriptUnit(unit: ExtractedUnit): boolean {
  if (unit.extractionMethod === TRANSCRIPT_METHOD) return true;
  const meta = unit.metadata ?? {};
  return meta["source"] === "audio_transcript" || meta["kind"] === "transcript";
}

/** The transcript segments of a unit list, in playback order. */
export function transcriptSegments(units: ExtractedUnit[]): ExtractedUnit[] {
  return units
    .filter(isTranscriptUnit)
    .slice()
    .sort((a, b) => a.unitOrder - b.unitOrder);
}

/** Format seconds as ``MM:SS`` (``H:MM:SS`` past an hour). */
export function formatTimestamp(seconds: number | null | undefined): string {
  const total = Math.max(0, Math.floor(seconds ?? 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const mm = String(minutes).padStart(2, "0");
  const ss = String(secs).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** ``00:12–00:18`` for one segment. */
export function segmentRange(unit: ExtractedUnit): string {
  return `${formatTimestamp(unit.startTimestampSeconds)}–${formatTimestamp(
    unit.endTimestampSeconds,
  )}`;
}
