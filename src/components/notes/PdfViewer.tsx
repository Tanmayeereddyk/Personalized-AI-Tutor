import { useEffect, useState } from "react";
import { Download, FileWarning, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { api } from "@/lib/api";
import { Modal } from "@/components/ui/kit";
import type { Note } from "@/lib/types";

interface PdfViewerProps {
  /** The note to show, or null to close the viewer. */
  note: Note | null;
  onClose: () => void;
}

/**
 * Show a saved note as a real PDF *inside* the app.
 *
 * Opening the PDF in a new tab requires `window.open` after an async fetch to
 * attach the auth token, which browsers block as a popup — so the tab silently
 * never opens. Rendering it here sidesteps that completely: the PDF is fetched
 * with the bearer token and shown in an iframe, with a Download action.
 */
export function PdfViewer({ note, onClose }: PdfViewerProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!note) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    setUrl(null);
    setError(null);
    api.notes
      .pdfUrl(note.id)
      .then((value) => {
        if (cancelled) {
          URL.revokeObjectURL(value);
          return;
        }
        objectUrl = value;
        setUrl(value);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not open the PDF.");
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [note]);

  const download = async () => {
    if (!note) return;
    setDownloading(true);
    try {
      await api.notes.downloadPdf(note.id, note.title);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not download the PDF.");
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Modal
      open={note !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title={note?.title ?? "Note"}
      description="Saved note rendered as a PDF."
      size="full"
    >
      {error ? (
        <div className="flex flex-col items-center px-6 py-12 text-center">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
            <FileWarning className="h-6 w-6" />
          </span>
          <p className="mt-4 font-medium">Couldn't open the PDF</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">{error}</p>
        </div>
      ) : !url ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Building the PDF…
        </div>
      ) : (
        <iframe
          src={url}
          title={`${note?.title ?? "Note"} PDF`}
          className="h-[75vh] w-full rounded-xl border bg-background"
        />
      )}
      <div className="mt-4 flex justify-end">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void download()}
          disabled={!url || downloading}
        >
          {downloading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          Download PDF
        </button>
      </div>
    </Modal>
  );
}
