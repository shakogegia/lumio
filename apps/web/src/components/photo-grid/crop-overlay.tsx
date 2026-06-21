"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clampCropToImage, type CropRect } from "@lumio/shared";

type Handle = "move" | "nw" | "ne" | "sw" | "se" | "n" | "s" | "e" | "w";
const MIN = 0.05; // minimum crop size as a fraction of O′

/** Interactive crop frame filling the O′ stage (pixel size stageW×stageH). `wo`/
 *  `ho`/`deg` describe the oriented image + straighten angle for the inscribed
 *  clamp (aspect-only — units don't matter). `crop` is normalized to O′ (null =
 *  full frame). Tracks the drag locally for a smooth preview; commits once per
 *  gesture via onCommit (→ one undo entry).
 *  Pass `interactive={false}` to render a read-only preview (dim + frame +
 *  rule-of-thirds, no handles, no pointer interaction). */
export function CropOverlay({
  stageW,
  stageH,
  wo,
  ho,
  deg,
  crop,
  ratio,
  onCommit,
  interactive = true,
}: {
  stageW: number;
  stageH: number;
  wo: number;
  ho: number;
  deg: number;
  crop: CropRect | null;
  ratio: number | null;
  onCommit: (c: CropRect) => void;
  interactive?: boolean;
}) {
  const drag = useRef<{ handle: Handle; startX: number; startY: number; start: CropRect } | null>(null);
  const [live, setLive] = useState<CropRect | null>(null);
  const rect = live ?? crop ?? { x: 0, y: 0, w: 1, h: 1 };

  // Keep the latest props/derived values accessible from event handlers without
  // recreating the callbacks on every render (same pattern as use-zoom-pan's stateRef).
  const stateRef = useRef({ stageW, stageH, wo, ho, deg, ratio, onCommit, rect });
  useEffect(() => {
    stateRef.current = { stageW, stageH, wo, ho, deg, ratio, onCommit, rect };
  });

  const onPointerDown = useCallback((e: React.PointerEvent<Element>) => {
    const handle = (e.currentTarget as HTMLElement).dataset.handle as Handle | undefined;
    if (!handle) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const { rect: r } = stateRef.current;
    drag.current = { handle, startX: e.clientX, startY: e.clientY, start: r };
    setLive(r);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const d = drag.current;
    const { stageW: sw, stageH: sh, wo: w, ho: h, deg: dg, ratio: ra } = stateRef.current;
    if (!d || sw === 0) return;
    const dx = (e.clientX - d.startX) / sw;
    const dy = (e.clientY - d.startY) / sh;
    setLive(clampCropToImage(applyDrag(d.handle, d.start, dx, dy, ra), w, h, dg));
  }, []);

  const onPointerUp = useCallback(() => {
    if (!drag.current) return;
    drag.current = null;
    const { onCommit: commit, rect } = stateRef.current;
    commit(rect);
    setLive(null);
  }, []);

  // A browser pointer-cancel (focus loss etc.) ends the drag; capture is released
  // automatically on cancel, so no need to call releasePointerCapture.
  const onPointerCancel = useCallback(() => {
    drag.current = null;
    setLive(null);
  }, []);

  const px = (v: number) => `${v * 100}%`;
  return (
    <div
      className="absolute inset-0"
      onPointerMove={interactive ? onPointerMove : undefined}
      onPointerUp={interactive ? onPointerUp : undefined}
      onPointerCancel={interactive ? onPointerCancel : undefined}
    >
      {/* dim surround */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute bg-black/50" style={{ left: 0, top: 0, right: 0, height: px(rect.y) }} />
        <div className="absolute bg-black/50" style={{ left: 0, bottom: 0, right: 0, height: px(1 - rect.y - rect.h) }} />
        <div className="absolute bg-black/50" style={{ top: px(rect.y), height: px(rect.h), left: 0, width: px(rect.x) }} />
        <div className="absolute bg-black/50" style={{ top: px(rect.y), height: px(rect.h), right: 0, width: px(1 - rect.x - rect.w) }} />
      </div>
      {/* crop frame */}
      <div
        className="absolute border border-white/90"
        data-handle={interactive ? "move" : undefined}
        style={{ left: px(rect.x), top: px(rect.y), width: px(rect.w), height: px(rect.h), cursor: interactive ? "move" : "default" }}
        onPointerDown={interactive ? onPointerDown : undefined}
      >
        {/* rule of thirds */}
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute top-0 bottom-0 bg-white/30" style={{ left: "33.33%", width: 1 }} />
          <div className="absolute top-0 bottom-0 bg-white/30" style={{ left: "66.66%", width: 1 }} />
          <div className="absolute left-0 right-0 bg-white/30" style={{ top: "33.33%", height: 1 }} />
          <div className="absolute left-0 right-0 bg-white/30" style={{ top: "66.66%", height: 1 }} />
        </div>
        {interactive &&
          (["nw", "ne", "sw", "se", "n", "s", "e", "w"] as Handle[]).map((h) => (
            <span
              key={h}
              data-handle={h}
              onPointerDown={onPointerDown}
              className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 border-2 border-white bg-black/40"
              style={handleStyle(h)}
            />
          ))}
      </div>
    </div>
  );
}

function handleStyle(h: Handle): React.CSSProperties {
  const x = h.includes("w") ? "0%" : h.includes("e") ? "100%" : "50%";
  const y = h.includes("n") ? "0%" : h.includes("s") ? "100%" : "50%";
  return { left: x, top: y, cursor: `${h}-resize` };
}

/** Next crop for a drag of (dx,dy) in O′ fractions. `ratio` locks the aspect when
 *  set; keeps a minimum size. */
function applyDrag(h: Handle, s: CropRect, dx: number, dy: number, ratio: number | null): CropRect {
  if (h === "move") {
    return {
      x: Math.min(Math.max(0, s.x + dx), 1 - s.w),
      y: Math.min(Math.max(0, s.y + dy), 1 - s.h),
      w: s.w,
      h: s.h,
    };
  }
  let { x, y, w, h: hh } = s;
  const right = s.x + s.w;
  const bottom = s.y + s.h;
  if (h.includes("e")) w = Math.max(MIN, s.w + dx);
  if (h.includes("w")) { x = Math.min(right - MIN, s.x + dx); w = right - x; }
  if (h.includes("s")) hh = Math.max(MIN, s.h + dy);
  if (h.includes("n")) { y = Math.min(bottom - MIN, s.y + dy); hh = bottom - y; }
  // ratio-locked dragging (future): every caller passes null today, so this is inert.
  if (ratio) hh = w / ratio; // keep width authoritative
  return { x, y, w, h: hh };
}
