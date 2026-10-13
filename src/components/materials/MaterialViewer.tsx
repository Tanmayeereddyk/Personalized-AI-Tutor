import { useEffect, useRef, useState } from "react";
import { Download, ExternalLink, FileWarning, Loader2 } from "lucide-react";

import { api } from "@/lib/api";
import { AudioTranscript } from "@/components/materials/AudioTranscript";
import { useExtractionStatus, useTranscript } from "@/lib/queries";
import type { Material } from "@/lib/types";

type UrlState = "idle" | "loading" | "ready" | "error";

function canPreview(material: Material): boolean {
  if (material.type === "pdf") return true;
  if (material.mimeType?.startsWith("image/")) return true;
  if (material.type === "video") return true;
  return false;
}

async function downloadFromUrl(url: string, name: string): Promise<void> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed (${res.status})`);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

/**
 * A file reader that fetches its own temporary access link.
 *
 * Used by the Materials page so a single block renders a PDF, image or lecture
 * recording (with its transcript) beside another panel, without the parent
 * having to manage the signed-URL lifecycle.
 */
export function MaterialViewer({
  material,
  showTranscript = true,
}: {
  material: Material;
  /** Video material only: pair the player with its transcript. */
  showTranscript?: boolean;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [state, setState] = useState<UrlState>("idle");
  const [session, setSession] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setUrl(null);
    api.materials
      .url(material.id)
      .then((value) => {
        if (cancelled) return;
        setUrl(value);
        setState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [material.id, session]);

  if (state === "loading") {
    return (
      <div className="card flex h-full items-center justify-center">
        <span className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Opening “{material.name}”…
        </span>
      </div>
    );
  }

  if (state === "error" || !url) {
    return (
      <div className="card flex h-full flex-col items-center justify-center px-6 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15 text-primary">
          <FileWarning className="h-6 w-6" />
        </span>
        <p className="mt-4 font-medium">Couldn't open this file</p>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">
          The temporary access link couldn't be created for “{material.name}”. This is often a
          storage syncing delay — try again.
        </p>
        <button className="btn btn-primary mt-5" onClick={() => setSession((s) => s + 1)}>
          Try again
        </button>
      </div>
    );
  }

  const previewable = canPreview(material);

  return (
    <div className="card flex h-full flex-col overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-2.5">
        <span className="truncate text-sm font-medium">{material.name}</span>
        <div className="flex shrink-0 items-center gap-1">
          <span className="hidden text-xs text-muted-foreground sm:inline">
            Private · link expires
          </span>
          <button
            type="button"
            className="btn btn-ghost px-2 py-1 text-xs"
            onClick={() => void downloadFromUrl(url, material.name)}
            title="Download this file"
          >
            <Download className="h-3.5 w-3.5" />
          </button>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-ghost px-2 py-1 text-xs"
            title="Open in a new tab"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 overflow-auto bg-surface-2">
        {!previewable ? (
          <div className="m-auto max-w-sm px-6 text-center">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15 text-primary">
              <FileWarning className="h-6 w-6" />
            </span>
            <p className="mt-4 font-medium">No inline preview for this file type</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Slides and documents from Microsoft Office can't be rendered inline yet. Download the
              file or open it in your usual app instead.
            </p>
          </div>
        ) : material.type === "pdf" ? (
          <iframe src={url} title={material.name} className="h-full w-full" />
        ) : material.type === "video" ? (
          <VideoReader
            material={material}
            session={session}
            url={url}
            showTranscript={showTranscript}
          />
        ) : (
          <img
            src={url}
            alt={material.name}
            className="m-auto max-h-full max-w-full object-contain"
          />
        )}
      </div>
    </div>
  );
}

function VideoReader({
  material,
  session,
  url,
  showTranscript = true,
}: {
  material: Material;
  session: number;
  url: string;
  showTranscript?: boolean;
}) {
  const playerRef = useRef<HTMLVideoElement>(null);
  const status = useExtractionStatus(material.id);
  const transcript = useTranscript(material.id, showTranscript);

  const seek = (seconds: number) => {
    const player = playerRef.current;
    if (!player) return;
    player.currentTime = seconds;
    void player.play();
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className={`flex min-h-0 items-center justify-center bg-black ${
          showTranscript ? "flex-[3]" : "flex-1"
        }`}
      >
        <video
          ref={playerRef}
          key={`${material.id}:${session}`}
          controls
          src={url}
          className="h-full max-h-full w-full"
        />
      </div>
      {showTranscript && (
        <div className="min-h-0 flex-[2] overflow-auto border-t bg-surface-2 p-3">
          <AudioTranscript
            segments={transcript.data ?? []}
            status={status.data?.status ?? material.status}
            stage={status.data?.stage}
            warnings={status.data?.warnings ?? []}
            loading={transcript.isLoading}
            error={transcript.isError}
            onSeek={seek}
          />
        </div>
      )}
    </div>
  );
}
