"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildToneLut,
  chromaParams,
  vignetteParams,
  colorCssFilter,
  type PhotoEdits,
} from "@lumio/shared";
import { GlColor, isWebGL2Available, type GlColorModel } from "./render/gl-color";

function glModel(working: PhotoEdits): GlColorModel {
  return {
    tone: buildToneLut(working, 256),
    chroma: chromaParams(working),
    vignette: vignetteParams(working),
  };
}

/**
 * Drop-in replacement for the editor's base `<img>` that applies the working
 * recipe's COLOR live on the GPU (the same shared math the bake runs, so the
 * preview equals the saved result). Renders a `<canvas>` at the image's natural
 * resolution; the caller's `style`/`className` (geometry transform, layout size)
 * scale it exactly as they did the `<img>`.
 *
 * Falls back to an `<img>` + CSS `filter` when WebGL2 is unavailable. The CSS
 * fallback can only express the per-pixel filters (exposure/brightness/contrast/
 * saturation/hue/−fade); the overlay-based effects (temperature/+fade/vignette)
 * and the v2 tonal sliders/curves are GL-only. WebGL2 is effectively universal,
 * so this is a rare safety net.
 */
export function AdjustedImage({
  src,
  working,
  onNaturalSize,
  className,
  style,
}: {
  src: string;
  working: PhotoEdits;
  onNaturalSize?: (s: { w: number; h: number }) => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  // Gate GL on mount so SSR and the first client render agree (no hydration
  // mismatch); switch to the canvas afterwards.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const mark = () => setMounted(true);
    mark();
  }, []);
  const useGl = mounted && isWebGL2Available();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const glRef = useRef<GlColor | null>(null);
  const [ready, setReady] = useState(false);

  // Keep the size callback reachable from the async loader without re-running it.
  const onSizeRef = useRef(onNaturalSize);
  useEffect(() => {
    onSizeRef.current = onNaturalSize;
  });

  const model = useMemo(() => glModel(working), [working]);

  // (Re)decode and upload whenever the source changes (e.g. zoom→full-res swap).
  useEffect(() => {
    if (!useGl) return;
    let cancelled = false;
    const markReady = () => setReady(true);
    const img = new Image();
    img.decoding = "async";
    img.src = src;
    img
      .decode()
      .then(() => {
        const canvas = canvasRef.current;
        if (cancelled || !canvas) return;
        let gl = glRef.current;
        if (!gl) gl = glRef.current = new GlColor(canvas);
        gl.setImage(img);
        onSizeRef.current?.({ w: img.naturalWidth, h: img.naturalHeight });
        markReady();
      })
      .catch(() => {
        // Source missing/unreadable — leave the canvas blank; the lightbox keeps
        // its own placeholder behaviour.
      });
    return () => {
      cancelled = true;
    };
  }, [src, useGl]);

  // Re-render on any color change (and once the image is ready).
  useEffect(() => {
    if (ready && glRef.current) glRef.current.render(model);
  }, [model, ready]);

  // Release GL resources on unmount.
  useEffect(
    () => () => {
      glRef.current?.dispose();
      glRef.current = null;
    },
    [],
  );

  if (!useGl) {
    return (
      /* eslint-disable-next-line @next/next/no-img-element */
      <img
        src={src}
        alt=""
        draggable={false}
        className={className}
        style={{ ...style, filter: colorCssFilter(working) || undefined }}
        onLoad={(e) =>
          onSizeRef.current?.({
            w: e.currentTarget.naturalWidth,
            h: e.currentTarget.naturalHeight,
          })
        }
      />
    );
  }

  return <canvas ref={canvasRef} className={className} style={style} />;
}
