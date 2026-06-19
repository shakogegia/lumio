import type { PhotoDTO } from "@lumio/shared";
import type { ThumbnailFit } from "@/lib/use-thumbnail-fit";

/**
 * One grid tile's photo. Renders the thumbnail at its *cover* size inside an
 * overflow-clipped square, then reaches "contain" by scaling DOWN to the
 * photo's short/long ratio. object-fit can't be CSS-animated, but transforms
 * can — and cover/contain are the same image at two zoom levels — so the
 * cover↔contain toggle becomes a smooth, GPU-accelerated zoom. Scaling down
 * (rather than up from contain) keeps the default cover view pixel-crisp.
 */
export function PhotoThumb({ photo, fit }: { photo: PhotoDTO; fit: ThumbnailFit }) {
  const { width: w, height: h } = photo;
  const valid = w > 0 && h > 0;
  const aspect = valid ? w / h : 1;
  const containScale = valid ? Math.min(w, h) / Math.max(w, h) : 1;
  return (
    <div className="group/tile relative h-full w-full overflow-hidden rounded-sm">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/thumbnails/${photo.id}`}
        alt={photo.path}
        loading="lazy"
        width={w}
        height={h}
        // The element is sized to the cover rectangle (long edge overflows the
        // square and is clipped); contain is the same element scaled down.
        className="absolute left-1/2 top-1/2 max-w-none rounded-sm object-cover transition-[transform,opacity] duration-300 ease-out group-hover/tile:opacity-90"
        style={{
          width: aspect >= 1 ? `${aspect * 100}%` : "100%",
          height: aspect >= 1 ? "100%" : `${(100 / aspect)}%`,
          transform: `translate(-50%, -50%) scale(${fit === "cover" ? 1 : containScale})`,
        }}
      />
    </div>
  );
}
