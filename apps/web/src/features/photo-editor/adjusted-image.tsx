"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  buildToneLut,
  chromaParams,
  detailParams,
  grainParams,
  linearParams,
  vignetteParams,
  type PhotoEdits,
} from "@lumio/shared";
import { GlColor, isWebGL2Available, type GlColorModel } from "./render/gl-color";

function glModel(working: PhotoEdits): GlColorModel {
  return {
    linear: linearParams(working),
    tone: buildToneLut(working, 256),
    chroma: chromaParams(working),
    vignette: vignetteParams(working),
    detail: detailParams(working),
    grain: grainParams(working),
  };
}

/**
 * Drop-in replacement for the editor's base `<img>` that applies the working
 * recipe's COLOR live on the GPU (the same shared math the bake runs, so the
 * preview equals the saved result). Renders a `<canvas>` at the image's natural
 * resolution; the caller's `style`/`className` (geometry transform, layout size)
 * scale it exactly as they did the `<img>`.
 *
 * Requires WebGL2 (effectively universal). On the rare device without it, falls
 * back to the un-adjusted `<img>` — the recipe's color can't be previewed without
 * the GPU, but the photo still shows. (The old CSS-`filter` fallback was dropped:
 * it could only fake a few of the adjustments and silently diverged from the bake.)
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
  // mismatch); switch to the canvas afterwards. The capability probe is memoized —
  // calling it per render would spawn (and leak) a WebGL2 context every render,
  // exhausting the browser's context pool mid-slider-drag and killing the editor's
  // own canvas.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const mark = () => setMounted(true);
    mark();
  }, []);
  const supported = useMemo(() => isWebGL2Available(), []);
  const useGl = mounted && supported;

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const glRef = useRef<GlColor | null>(null);

  // Keep the size callback reachable from the async loader without re-running it.
  const onSizeRef = useRef(onNaturalSize);
  useEffect(() => {
    onSizeRef.current = onNaturalSize;
  });

  const model = useMemo(() => glModel(working), [working]);

  // Latest model reachable from the async (re)upload below, without making the
  // decode effect depend on `model` — that would re-decode the source on every
  // slider tick.
  const modelRef = useRef(model);
  useEffect(() => {
    modelRef.current = model;
  });

  // (Re)decode and upload whenever the source changes (e.g. zoom→full-res swap).
  useEffect(() => {
    if (!useGl) return;
    let cancelled = false;
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
        // setImage resizes the canvas, which clears it — repaint now. The
        // color-change effect below won't fire on a pure src swap (same recipe,
        // e.g. the zoom→full-res swap), so without this the canvas goes blank.
        gl.render(modelRef.current);
      })
      .catch(() => {
        // Source missing/unreadable — leave the canvas blank; the lightbox keeps
        // its own placeholder behaviour.
      });
    return () => {
      cancelled = true;
    };
  }, [src, useGl]);

  // Re-render on any color change (slider/curve edits). No-op until the first
  // upload has created the GL context.
  useEffect(() => {
    glRef.current?.render(model);
  }, [model]);

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
        style={style}
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
