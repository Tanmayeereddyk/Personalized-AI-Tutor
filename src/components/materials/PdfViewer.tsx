import { useEffect, useRef, useState } from "react";
import { Loader2, Maximize2 } from "lucide-react";

/**
 * Uses the browser's built-in PDF renderer, preserving the uploaded PDF bytes
 * and its original layout. Chromium/Firefox/Safari provide their own page
 * navigation and zoom controls; the fragment controls provide a consistent
 * page/zoom entry point and the wrapper can be expanded to fullscreen.
 */
export function PdfViewer({ src, title }: { src: string; title: string }) {
  const viewerRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(100);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const hash = `#toolbar=1&navpanes=0&page=${page}&zoom=${zoom}`;
  const source = `${src.split("#", 1)[0]}${hash}`;

  useEffect(() => {
    setLoading(true);
    setLoadFailed(false);
  }, [src]);

  const fullscreen = async () => {
    try {
      await viewerRef.current?.requestFullscreen?.();
    } catch {
      // Fullscreen can be denied by browser policy; the embedded viewer stays usable.
    }
  };

  return (
    <section ref={viewerRef} className="relative flex h-full min-h-0 w-full flex-col bg-surface-2">
      <div className="flex shrink-0 items-center justify-center gap-2 border-b bg-card px-2 py-1.5">
        <button
          type="button"
          className="btn btn-ghost px-2 py-1 text-xs"
          aria-label="Previous PDF page"
          onClick={() => {
            setLoading(true);
            setPage((current) => Math.max(1, current - 1));
          }}
        >
          Previous
        </button>
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          Page
          <input
            aria-label="PDF page number"
            type="number"
            min={1}
            value={page}
            onChange={(event) => {
              setLoading(true);
              setPage(Math.max(1, Number(event.target.value) || 1));
            }}
            className="h-7 w-14 rounded border bg-background px-1 text-center text-foreground"
          />
        </label>
        <button
          type="button"
          className="btn btn-ghost px-2 py-1 text-xs"
          aria-label="Next PDF page"
          onClick={() => {
            setLoading(true);
            setPage((current) => current + 1);
          }}
        >
          Next
        </button>
        <label className="ml-2 flex items-center gap-1 text-xs text-muted-foreground">
          Zoom
          <select
            aria-label="PDF zoom"
            value={zoom}
            onChange={(event) => {
              setLoading(true);
              setZoom(Number(event.target.value));
            }}
            className="h-7 rounded border bg-background px-1 text-foreground"
          >
            {[50, 75, 100, 125, 150, 200].map((value) => (
              <option key={value} value={value}>{value}%</option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="btn btn-ghost px-2 py-1 text-xs"
          aria-label="View PDF fullscreen"
          onClick={() => void fullscreen()}
        >
          <Maximize2 className="h-3.5 w-3.5" />
          Fullscreen
        </button>
      </div>
      {loading && !loadFailed ? (
        <div className="absolute inset-x-0 bottom-0 top-10 z-10 flex items-center justify-center bg-surface-2/90 text-sm text-muted-foreground">
          <span className="flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Loading PDF…</span>
        </div>
      ) : null}
      {loadFailed ? (
        <div role="alert" className="m-auto max-w-md p-6 text-center text-sm text-muted-foreground">
          This browser could not display the PDF inline. Open it in a new tab or download the
          original file from the material toolbar.
        </div>
      ) : null}
      <iframe
        key={`${page}:${zoom}`}
        src={source}
        title={title}
        className="min-h-0 w-full flex-1"
        allowFullScreen
        onLoad={() => setLoading(false)}
        onError={() => setLoadFailed(true)}
      />
    </section>
  );
}
