import { useEffect, useState } from "react";
import { FileWarning } from "lucide-react";

export function ImagePreview({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (failed) {
    return (
      <div role="alert" className="m-auto max-w-sm p-6 text-center text-sm text-muted-foreground">
        <FileWarning className="mx-auto mb-2 h-6 w-6 text-warning" />
        This image could not be displayed. You can still download the original file.
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      onError={() => setFailed(true)}
      className="m-auto max-h-full max-w-full object-contain"
    />
  );
}
