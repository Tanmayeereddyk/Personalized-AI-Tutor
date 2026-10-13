import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * A full-page overlay for the study workspaces.
 *
 * Unlike simply widening the page, this takes over the entire viewport so the
 * workspace is as big as possible, and shows a small close (×) control in the
 * top-right corner. It is rendered through a portal so it is positioned against
 * the viewport even when an animated ancestor (`fade-up`) is transformed.
 */
export function FullScreenPage({
  title,
  onClose,
  children,
}: {
  title?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  // Lock background scrolling and close on Escape, like a dialog.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  const overlay = (
    <div
      className="fixed inset-0 z-50 flex flex-col overflow-hidden bg-background"
      role="dialog"
      aria-modal="true"
      aria-label="Full screen workspace"
    >
      <header className="flex items-center gap-3 border-b px-4 py-2.5">
        {title ? <span className="truncate text-sm font-semibold">{title}</span> : null}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close full screen"
          title="Close full screen"
          className="ml-auto rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <X className="h-5 w-5" />
        </button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-auto p-4">{children}</div>
    </div>
  );

  if (typeof document === "undefined") return null;
  return createPortal(overlay, document.body);
}
