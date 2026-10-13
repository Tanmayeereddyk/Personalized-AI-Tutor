import { AlertCircle, CheckCircle2, Loader2, Mic, Play } from "lucide-react";

import type { ExtractedUnit, ExtractionStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import { formatTimestamp, segmentRange } from "@/lib/transcript";

interface AudioTranscriptProps {
  /** Transcript segments, already ordered (see transcriptSegments). */
  segments: ExtractedUnit[];
  /** The material's extraction status (drives loading/processing messages). */
  status?: ExtractionStatus["status"] | undefined;
  /** Live stage reported by the backend while a video is being processed. */
  stage?: string | null | undefined;
  /** Persisted extraction warnings (no-audio / no-speech messages). */
  warnings?: string[] | undefined;
  /** True while the transcript request is still in flight. */
  loading?: boolean | undefined;
  /** True when the transcript request failed. */
  error?: boolean | undefined;
  /** Called with a segment's start time (seconds) to seek the video player. */
  onSeek?: ((seconds: number) => void) | undefined;
  className?: string | undefined;
}

/** Clear, stage-aware message while a video is being transcribed. */
export function processingMessage(stage: string | null | undefined): string {
  if (stage === "extracting_audio") return "Extracting audio…";
  if (stage === "transcribing") return "Transcribing speech…";
  return "Extracting audio and transcribing speech…";
}

/** Honest reason there is no transcript, derived from the backend warnings. */
export function emptyTranscriptMessage(
  status: ExtractionStatus["status"] | undefined,
  warnings: string[] | undefined,
): string {
  const text = (warnings ?? []).join(" ").toLowerCase();
  if (text.includes("no audio"))
    return "This video has no audio track, so there is nothing to transcribe.";
  if (text.includes("no clear speech") || text.includes("no speech"))
    return "No recognizable speech was found in this video.";
  if (text.includes("whisper") || text.includes("ffmpeg"))
    return "Local speech transcription isn't available in this environment.";
  if (status === "attention")
    return warnings?.[0] ?? "No transcript could be produced for this video.";
  return "No audio transcript yet. Run extraction to transcribe this video's speech.";
}

function StatusLine({
  icon: Icon,
  text,
  spin = false,
  tone = "muted",
}: {
  icon: typeof Mic;
  text: string;
  spin?: boolean;
  tone?: "muted" | "destructive";
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-2 px-2 py-2 text-sm",
        tone === "destructive" ? "text-destructive" : "text-muted-foreground",
      )}
    >
      <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", spin && "animate-spin")} />
      <span>{text}</span>
    </div>
  );
}

export function AudioTranscript({
  segments,
  status,
  stage,
  warnings,
  loading = false,
  error = false,
  onSeek,
  className,
}: AudioTranscriptProps) {
  const hasSegments = segments.length > 0;
  const processing = status === "processing";

  return (
    <section
      className={cn(
        "overflow-hidden rounded-xl border border-border/60 bg-surface/40",
        className,
      )}
      aria-label="Audio Transcript"
    >
      <header className="flex items-center gap-2 border-b border-border/60 px-4 py-3">
        <Mic className="h-4 w-4 text-course-violet" />
        <h3 className="text-sm font-semibold">Audio Transcript</h3>
        {segments.length > 0 && (
          <span className="ml-auto inline-flex items-center gap-1 text-xs text-emerald-600">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Transcript ready
          </span>
        )}
      </header>

      <div className="max-h-[60vh] space-y-0.5 overflow-y-auto p-2">
        {loading && <StatusLine icon={Loader2} spin text="Loading transcript…" />}

        {!loading && error && (
          <StatusLine
            icon={AlertCircle}
            tone="destructive"
            text="The transcript couldn't be loaded. Retry extraction or refresh the page."
          />
        )}

        {!loading && !error && segments.length === 0 && status === "processing" && (
          <StatusLine icon={Loader2} spin text={processingMessage(stage)} />
        )}

        {!loading && !error && segments.length === 0 && status !== "processing" && (
          <StatusLine
            icon={AlertCircle}
            text={emptyTranscriptMessage(status, warnings)}
          />
        )}

        {!loading &&
          !error &&
          segments.map((segment) => {
            const content = segment.content ?? "";
            if (!content) return null;
            const start = segment.startTimestampSeconds ?? 0;
            return (
              <div
                key={segment.id}
                className="flex gap-3 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted/40"
              >
                {onSeek ? (
                  <button
                    type="button"
                    onClick={() => onSeek(start)}
                    title={`Play from ${formatTimestamp(start)}`}
                    aria-label={`Play from ${formatTimestamp(start)}`}
                    className="flex shrink-0 items-center gap-1 font-mono text-xs text-course-violet hover:underline"
                  >
                    <Play className="h-3 w-3" />
                    {segmentRange(segment)}
                  </button>
                ) : (
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">
                    {segmentRange(segment)}
                  </span>
                )}
                <p className="text-sm leading-relaxed text-foreground/90">{content}</p>
              </div>
            );
          })}
      </div>
    </section>
  );
}
