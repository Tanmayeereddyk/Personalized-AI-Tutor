import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AudioTranscript, emptyTranscriptMessage, processingMessage } from "./AudioTranscript";
import { formatTimestamp, isTranscriptUnit, segmentRange, transcriptSegments } from "@/lib/transcript";
import type { ExtractedUnit } from "@/lib/types";

const unit = (overrides: Partial<ExtractedUnit> = {}): ExtractedUnit => ({
  id: "u1",
  materialId: "m1",
  contentType: "text",
  content: "Welcome back.",
  pageNumber: null,
  slideNumber: null,
  startTimestampSeconds: 12,
  endTimestampSeconds: 18,
  assetPath: null,
  extractionMethod: "whisper_transcription",
  status: "extracted",
  unitOrder: 10_000_001,
  metadata: { source: "audio_transcript", kind: "transcript" },
  ...overrides,
});

describe("transcript helpers", () => {
  it("formats timestamps as MM:SS and H:MM:SS", () => {
    expect(formatTimestamp(0)).toBe("00:00");
    expect(formatTimestamp(72)).toBe("01:12");
    expect(formatTimestamp(3661)).toBe("1:01:01");
  });

  it("renders an en-dash segment range", () => {
    expect(segmentRange(unit())).toBe("00:12–00:18");
  });

  it("identifies transcript units by method or metadata", () => {
    expect(isTranscriptUnit(unit())).toBe(true);
    expect(isTranscriptUnit(unit({ extractionMethod: "x", metadata: { source: "audio_transcript" } }))).toBe(true);
    expect(isTranscriptUnit(unit({ extractionMethod: "pdf_text", metadata: { source: "text" } }))).toBe(false);
  });

  it("orders transcript segments by unit order and drops frames", () => {
    const frame = unit({
      id: "f1",
      contentType: "image",
      extractionMethod: "video_frame",
      metadata: { source: "frame" },
      unitOrder: 1,
    });
    const segments = transcriptSegments([
      unit({ id: "t2", unitOrder: 10_000_002 }),
      frame,
      unit({ id: "t1", unitOrder: 10_000_001 }),
    ]);
    expect(segments.map((s) => s.id)).toEqual(["t1", "t2"]);
  });
});

describe("AudioTranscript", () => {
  it("lists timestamped segments and seeks the player when clicked", () => {
    const onSeek = vi.fn();
    render(<AudioTranscript segments={[unit()]} status="ready" onSeek={onSeek} />);

    expect(screen.getByText("Audio Transcript")).toBeInTheDocument();
    expect(screen.getByText("Transcript ready")).toBeInTheDocument();
    expect(screen.getByText("Welcome back.")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Play from 00:12"));
    expect(onSeek).toHaveBeenCalledWith(12);
  });

  it("does not make timestamps clickable without a player", () => {
    render(<AudioTranscript segments={[unit()]} status="ready" />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("00:12–00:18")).toBeInTheDocument();
  });

  it("shows a loading indicator", () => {
    render(<AudioTranscript segments={[]} loading />);
    expect(screen.getByText("Loading transcript…")).toBeInTheDocument();
  });

  it("shows stage-aware messages while processing", () => {
    const { rerender } = render(
      <AudioTranscript segments={[]} status="processing" stage="extracting_audio" />,
    );
    expect(screen.getByText("Extracting audio…")).toBeInTheDocument();

    rerender(<AudioTranscript segments={[]} status="processing" stage="transcribing" />);
    expect(screen.getByText("Transcribing speech…")).toBeInTheDocument();

    rerender(<AudioTranscript segments={[]} status="processing" stage={null} />);
    expect(screen.getByText("Extracting audio and transcribing speech…")).toBeInTheDocument();
  });

  it("explains when there is no audio or no speech", () => {
    const { rerender } = render(
      <AudioTranscript
        segments={[]}
        status="attention"
        warnings={["This video has no audio track, so there is no speech to transcribe."]}
      />,
    );
    expect(screen.getByText(/no audio track/i)).toBeInTheDocument();

    rerender(
      <AudioTranscript
        segments={[]}
        status="attention"
        warnings={["The audio was transcribed but no clear speech was recognized."]}
      />,
    );
    expect(screen.getByText(/No recognizable speech/)).toBeInTheDocument();
  });

  it("prompts to run extraction when there is no transcript yet", () => {
    render(<AudioTranscript segments={[]} status="ready" />);
    expect(screen.getByText(/Run extraction to transcribe/i)).toBeInTheDocument();
  });

  it("surfaces a load error honestly", () => {
    render(<AudioTranscript segments={[]} error />);
    expect(screen.getByText(/couldn't be loaded/i)).toBeInTheDocument();
  });
});

describe("message helpers", () => {
  it("maps backend warnings to honest empty-state copy", () => {
    expect(emptyTranscriptMessage("attention", ["This video has no audio track"])).toMatch(
      /no audio track/i,
    );
    expect(emptyTranscriptMessage("attention", ["no clear speech was recognized"])).toMatch(
      /no recognizable speech/i,
    );
    expect(emptyTranscriptMessage("attention", ["requires 'openai-whisper'"])).toMatch(
      /isn't available/i,
    );
    expect(emptyTranscriptMessage("ready", [])).toMatch(/run extraction/i);
  });

  it("labels stages", () => {
    expect(processingMessage("extracting_audio")).toBe("Extracting audio…");
    expect(processingMessage("transcribing")).toBe("Transcribing speech…");
    expect(processingMessage(null)).toMatch(/transcribing speech/i);
  });
});
