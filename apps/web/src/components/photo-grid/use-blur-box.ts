import { useCallback, useEffect, useRef, useState } from "react";

export interface BlurBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Measure the visible rectangle of the object-contain image so the blur lands
 * pixel-perfectly. Ported from the original photo-detail measurement effect.
 *
 * Returns a callback-ref `setImgEl` (instead of a RefObject) so callers can
 * compose it with other callback-refs (e.g. useImageLoaded's `ref`) without
 * needing to write `imgRef.current = node`, which would trigger
 * react-hooks/immutability.
 */
export function useBlurBox(width: number, height: number, photoId: string) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgElRef = useRef<HTMLImageElement | null>(null);
  const [blurBox, setBlurBox] = useState<BlurBox | null>(null);

  useEffect(() => {
    const img = imgElRef.current;
    const container = containerRef.current;
    if (!img || !container) return;
    const ar = width / height;
    const measure = () => {
      const cw = img.clientWidth;
      const ch = img.clientHeight;
      if (!cw || !ch || !ar) return setBlurBox(null);
      let vw: number, vh: number;
      if (cw / ch > ar) {
        vh = ch;
        vw = ch * ar;
      } else {
        vw = cw;
        vh = cw / ar;
      }
      const ir = img.getBoundingClientRect();
      const cr = container.getBoundingClientRect();
      setBlurBox({
        left: ir.left - cr.left + (cw - vw) / 2,
        top: ir.top - cr.top + (ch - vh) / 2,
        width: vw,
        height: vh,
      });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(img);
    ro.observe(container);
    return () => ro.disconnect();
  }, [width, height, photoId]);

  // Callback-ref so callers can compose with other callback-refs without
  // mutating .current directly (avoids react-hooks/immutability violation).
  const setImgEl = useCallback((node: HTMLImageElement | null) => {
    imgElRef.current = node;
  }, []);

  return { containerRef, setImgEl, blurBox };
}
