import { useMemo, useState } from "react";
import type { PhotoDTO } from "@lumio/shared";
import type { GridViewMode } from "@/lib/use-grid-view";
import { thumbhashDataUrl } from "@/lib/thumbhash-url";

/**
 * One grid tile's photo. Renders the thumbnail at its *cover* size inside an
 * overflow-clipped square, then reaches "contain" by scaling DOWN to the
 * photo's short/long ratio. "fill" covers (edge-to-edge); "fit" and "card"
 * contain (whole photo). object-fit can't be CSS-animated, but transforms can —
 * and cover/contain are the same image at two zoom levels — so switching modes
 * becomes a smooth, GPU-accelerated zoom. Scaling down (rather than up from
 * contain) keeps the default fill view pixel-crisp.
 */
export function PhotoThumb({ photo, mode }: { photo: PhotoDTO; mode: GridViewMode }) {
  const [loaded, setLoaded] = useState(false);
  const blurUrl = useMemo(() => thumbhashDataUrl(photo.thumbhash), [photo.thumbhash]);

  const { width: w, height: h } = photo;
  const valid = w > 0 && h > 0;
  const aspect = valid ? w / h : 1;
  const containScale = valid ? Math.min(w, h) / Math.max(w, h) : 1;
  // Only "fill" covers; "fit" and "card" show the whole photo (contained).
  const cover = mode === "fill";
  // The blur placeholder must occupy the *exact same* box as the thumbnail — not
  // fill the square tile — so the contained ("fit"/"card") modes don't bleed the
  // blur into the letterbox. The thumbnail's box here is deterministic (aspect +
  // contain scale), so the blur reuses the same geometry rather than measuring.
  const boxStyle = {
    width: aspect >= 1 ? `${aspect * 100}%` : "100%",
    height: aspect >= 1 ? "100%" : `${100 / aspect}%`,
    transform: `translate(-50%, -50%) scale(${cover ? 1 : containScale})`,
  } as const;
  return (
    <div className="group/tile relative h-full w-full overflow-hidden">
      {blurUrl && (
        <div
          aria-hidden
          className="absolute left-1/2 top-1/2 max-w-none bg-cover bg-center transition-[transform,opacity] duration-300 ease-out"
          style={{ ...boxStyle, backgroundImage: `url(${blurUrl})`, opacity: loaded ? 0 : 1 }}
        />
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/thumbnails/${photo.id}`}
        alt={photo.path}
        loading="lazy"
        decoding="async"
        width={w}
        height={h}
        onLoad={() => setLoaded(true)}
        // The element is sized to the cover rectangle (long edge overflows the
        // square and is clipped); contain is the same element scaled down.
        className="absolute left-1/2 top-1/2 max-w-none object-cover transition-[transform,opacity] duration-300 ease-out group-hover/tile:opacity-90"
        style={boxStyle}
      />
    </div>
  );
}
