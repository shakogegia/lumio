import { useCallback, useEffect, useRef, useState } from "react";

/**
 * True once an <img> has finished loading AND successfully decoded. The
 * `naturalWidth > 0` check distinguishes a genuinely decoded image from a
 * `complete` but broken one. This is the predicate that fixes the stuck blur:
 * a cached image is already `complete` at mount, so `onLoad` may never fire —
 * we must read this synchronously instead of relying on the event.
 */
export function imageElementReady(
  el: { complete: boolean; naturalWidth: number } | null,
): boolean {
  return !!el && el.complete && el.naturalWidth > 0;
}

/**
 * Track whether the image at `src` is loaded, robust to the cached-image race.
 * Returns `{ loaded, ref, onLoad }` to spread onto an <img>. Resets when `src`
 * changes; resolves true via the ref callback (catches an already-complete
 * cached image) OR the onLoad event (catches a fresh network load).
 */
export function useImageLoaded(src: string) {
  const [loaded, setLoaded] = useState(false);
  const elRef = useRef<HTMLImageElement | null>(null);

  // Reset whenever the source changes (the persistent <img> swaps photos). If
  // the element already shows the new src as a decoded cached image, stay loaded
  // (avoids a blur flash); otherwise false until the ref callback / onLoad fires.
  useEffect(() => {
    const el = elRef.current;
    setLoaded(imageElementReady(el) && (el?.currentSrc.length ?? 0) > 0);
  }, [src]);

  const ref = useCallback((node: HTMLImageElement | null) => {
    elRef.current = node;
    if (imageElementReady(node)) setLoaded(true);
  }, []);

  const onLoad = useCallback(() => setLoaded(true), []);

  return { loaded, ref, onLoad };
}
