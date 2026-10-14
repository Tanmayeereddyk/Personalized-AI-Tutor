import { cn } from "@/lib/utils";

/**
 * The Lumino logo — the yellow bee mascot with the "Lumio" wordmark.
 *
 * The artwork ships with a solid black background, so it is always
 * rendered inside a rounded black tile: on light themes the tile reads
 * as an intentional logo chip instead of an awkward black rectangle,
 * and on dark themes it blends in naturally. The image's own aspect
 * ratio (563×403) is preserved with `object-contain`, so neither the
 * bee nor the wordmark is ever stretched, cropped or distorted.
 */
export function Logo({
  className,
  alt = "Lumio",
}: {
  className?: string;
  alt?: string;
}) {
  return (
    <span
      className={cn("block aspect-[563/403] overflow-hidden rounded-lg bg-black", className)}
    >
      <img
        src="/logo.png"
        alt={alt}
        className="block h-full w-full object-contain"
        draggable={false}
      />
    </span>
  );
}
