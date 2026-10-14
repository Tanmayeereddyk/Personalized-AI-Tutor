import { useEffect } from "react";
import { FileWarning, Loader2, Presentation } from "lucide-react";

import { useMaterialPreview, useStartMaterialPreview } from "@/lib/queries";
import type { Material } from "@/lib/types";

/**
 * Inline preview for a material.
 *
 * A browser can't render an Office file, so the backend converts
 * presentations and Word documents to a PDF with a local
 * LibreOffice, and this component reuses the same `<iframe>` the
 * PDF viewer uses. Opening the material starts the conversion
 * (idempotently) and polls until it is ready.
 *
 * Plain text always renders directly. When LibreOffice is not
 * installed — or the conversion fails — the component falls back
 * to the text the extraction pipeline already produced (slide
 * text for decks, document text for Word files), explains the
 * situation, and keeps working. The original file is never
 * touched: the viewer's header still offers Download /
 * Open-in-new-tab for it.
 */
export function PreviewPane({ material }: { material: Material }) {
  const start = useStartMaterialPreview(material.id);
  const preview = useMaterialPreview(material.id, isPreviewable(material));
  const { mutate } = start;

  // Kicking off the conversion is safe to repeat: the endpoint is
  // idempotent and never converts an already-converted material.
  useEffect(() => {
    mutate();
  }, [mutate, material.id]);

  const data = preview.data;
  const status = data?.status ?? (start.isPending ? "processing" : "none");

  if (!data || status === "processing" || status === "none") {
    return (
      <div className="flex h-full items-center justify-center">
        <span className="flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          Preparing the preview…
        </span>
      </div>
    );
  }

  // A converted PDF — rendered with the same viewer as uploaded PDFs.
  if (data.mode === "pdf" && data.url) {
    return (
      <iframe
        src={data.url}
        title={material.name}
        className="h-full w-full"
      />
    );
  }

  // Slide text (and any slide image) from the extraction pipeline.
  if (data.mode === "slides" && data.slides.length > 0) {
    return (
      <div className="h-full overflow-auto">
        {data.message ? <PreviewNotice message={data.message} /> : null}
        <ol className="flex flex-col gap-4 p-4">
          {data.slides.map((slide) => (
            <li
              key={slide.number}
              className="overflow-hidden rounded-xl border bg-card"
            >
              <div className="flex items-center gap-2 border-b px-3 py-1.5 text-xs text-muted-foreground">
                <Presentation className="h-3.5 w-3.5" />
                Slide {slide.number}
              </div>
              {slide.imageUrl ? (
                <img
                  src={slide.imageUrl}
                  alt={`Slide ${slide.number}`}
                  className="max-h-[46vh] w-full object-contain"
                />
              ) : (
                <p className="whitespace-pre-wrap px-3 py-3 text-sm">
                  {slide.text || "(no text on this slide)"}
                </p>
              )}
            </li>
          ))}
        </ol>
      </div>
    );
  }

  // Document / plain-text content from the extraction pipeline.
  if (data.mode === "text" && data.text) {
    return (
      <div className="h-full overflow-auto">
        {data.message ? <PreviewNotice message={data.message} /> : null}
        <pre className="whitespace-pre-wrap p-4 font-sans text-sm">
          {data.text}
        </pre>
      </div>
    );
  }

  // Nothing to show — explain why, without hiding the download option.
  return (
    <div className="m-auto max-w-sm px-6 text-center">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/15 text-primary">
        <FileWarning className="h-6 w-6" />
      </span>
      <p className="mt-4 font-medium">No inline preview available</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {data.message ??
          "This file could not be previewed inline. Download it to view it."}
      </p>
    </div>
  );
}

function isPreviewable(material: Material): boolean {
  return material.type === "ppt" || material.type === "doc";
}

function PreviewNotice({ message }: { message: string }) {
  return (
    <div
      role="status"
      className="mx-4 mt-4 flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-sm text-amber-700 dark:text-amber-300"
    >
      <FileWarning className="mt-0.5 h-4 w-4 shrink-0" />
      <p>{message}</p>
    </div>
  );
}
