# Photo detail zoom & pan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add iCloud-style zoom & pan to the photo detail view — a top-left slider with `–`/`+` stops (fit→100→200→300→400), pinch/wheel zoom toward the cursor, click-drag and 2-finger-swipe panning, and a lazy full-resolution swap.

**Architecture:** A pure `zoom-math` module holds all geometry (fit scale, stops, clamping, zoom-toward-point). A headless `useZoomPan` hook owns `{zoom, offset}` state and wires events to a single CSS `transform`. A presentational `ZoomControls` drives the hook. An extracted `ZoomableImage` hosts the viewport/transform layer, the blur-up, and the original-swap, and replaces today's inline `LightboxImage`.

**Tech Stack:** Next.js (App Router) + React, TypeScript, Tailwind, shadcn/radix `Slider` + `Button`, lucide icons, Vitest (node env). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-06-20-photo-detail-zoom-pan-design.md`

---

## File Structure

- **Create** `apps/web/src/lib/zoom-math.ts` — pure geometry functions (no React, no DOM). The testable core.
- **Create** `apps/web/src/lib/zoom-math.test.ts` — Vitest unit tests for the above.
- **Create** `apps/web/src/components/photo-grid/use-zoom-pan.ts` — headless hook: state, event handlers, imperative API, native non-passive wheel listener, `ResizeObserver` viewport measurement.
- **Create** `apps/web/src/components/photo-grid/zoom-controls.tsx` — top-left `–` / `Slider` / `+` overlay.
- **Create** `apps/web/src/components/photo-grid/zoomable-image.tsx` — extracted from `LightboxImage`; viewport + transform layer + blur-up + original-swap + nav arrows + zoom controls.
- **Modify** `apps/web/src/components/photo-grid/lightbox.tsx` — remove the inline `LightboxImage` and `NavArrow`; render `<ZoomableImage key={photo.id} … />`.

Commands used throughout:
- Run one test file: `pnpm --filter @lumio/web test src/lib/zoom-math.test.ts`
- Lint: `pnpm --filter @lumio/web lint`
- Typecheck: `pnpm --filter @lumio/web exec tsc --noEmit`

---

## Task 1: `zoom-math` pure geometry module

**Files:**
- Create: `apps/web/src/lib/zoom-math.ts`
- Test: `apps/web/src/lib/zoom-math.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/zoom-math.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  clampOffset,
  clampZoom,
  computeFitZoom,
  computeStops,
  MAX_ZOOM,
  nextStop,
  prevStop,
  scaledSize,
  zoomToward,
} from "./zoom-math";

describe("computeFitZoom", () => {
  it("scales a large photo down to fit (below 100)", () => {
    expect(computeFitZoom({ width: 6000, height: 4000 }, { width: 1200, height: 800 })).toBeCloseTo(20);
  });
  it("never upscales a small photo past 100", () => {
    expect(computeFitZoom({ width: 400, height: 300 }, { width: 1200, height: 800 })).toBe(100);
  });
  it("is limited by the tighter axis", () => {
    expect(computeFitZoom({ width: 1000, height: 4000 }, { width: 1000, height: 1000 })).toBeCloseTo(25);
  });
  it("returns 100 when the viewport is unmeasured", () => {
    expect(computeFitZoom({ width: 6000, height: 4000 }, { width: 0, height: 0 })).toBe(100);
  });
});

describe("clampZoom", () => {
  it("clamps below fit up to fit", () => {
    expect(clampZoom(10, 20)).toBe(20);
  });
  it("clamps above max down to 400", () => {
    expect(clampZoom(900, 20)).toBe(MAX_ZOOM);
  });
  it("passes through a value in range", () => {
    expect(clampZoom(150, 20)).toBe(150);
  });
});

describe("computeStops", () => {
  it("includes fit then every 100-step strictly above it", () => {
    expect(computeStops(20)).toEqual([20, 100, 200, 300, 400]);
  });
  it("drops stops at or below fit", () => {
    expect(computeStops(100)).toEqual([100, 200, 300, 400]);
    expect(computeStops(250)).toEqual([250, 300, 400]);
  });
});

describe("nextStop / prevStop", () => {
  const stops = [20, 100, 200, 300, 400];
  it("advances to the next stop above the current zoom", () => {
    expect(nextStop(20, stops)).toBe(100);
    expect(nextStop(100, stops)).toBe(200);
    expect(nextStop(150, stops)).toBe(200);
  });
  it("caps at the top stop", () => {
    expect(nextStop(400, stops)).toBe(400);
  });
  it("retreats to the previous stop below the current zoom", () => {
    expect(prevStop(400, stops)).toBe(300);
    expect(prevStop(100, stops)).toBe(20);
    expect(prevStop(150, stops)).toBe(100);
  });
  it("floors at fit", () => {
    expect(prevStop(20, stops)).toBe(20);
  });
});

describe("scaledSize", () => {
  it("is the photo size at 100%", () => {
    expect(scaledSize({ width: 6000, height: 4000 }, 100)).toEqual({ width: 6000, height: 4000 });
  });
  it("halves at 50%", () => {
    expect(scaledSize({ width: 6000, height: 4000 }, 50)).toEqual({ width: 3000, height: 2000 });
  });
});

describe("clampOffset", () => {
  const viewport = { width: 1000, height: 800 };
  it("limits panning to the scaled image's overflow on each side", () => {
    const scaled = { width: 2000, height: 800 };
    expect(clampOffset({ x: 999, y: 50 }, scaled, viewport)).toEqual({ x: 500, y: 0 });
    expect(clampOffset({ x: -999, y: -50 }, scaled, viewport)).toEqual({ x: -500, y: 0 });
  });
  it("locks an axis to 0 when the image is smaller than the viewport there", () => {
    const scaled = { width: 600, height: 600 };
    expect(clampOffset({ x: 100, y: 100 }, scaled, viewport)).toEqual({ x: 0, y: 0 });
  });
});

describe("zoomToward", () => {
  it("keeps the centered point fixed when anchored at center", () => {
    expect(zoomToward({ x: 0, y: 0 }, 100, 200, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });
  it("shifts the offset so the cursor point stays under the cursor", () => {
    // offset' = c - (to/from)(c - offset) = 100 - 2*(100 - 0) = -100
    expect(zoomToward({ x: 100, y: 0 }, 100, 200, { x: 0, y: 0 })).toEqual({ x: -100, y: 0 });
  });
  it("is symmetric when zooming back out", () => {
    expect(zoomToward({ x: 100, y: 0 }, 200, 100, { x: -100, y: 0 })).toEqual({ x: 0, y: 0 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @lumio/web test src/lib/zoom-math.test.ts`
Expected: FAIL — cannot resolve `./zoom-math` (module not created yet).

- [ ] **Step 3: Write the minimal implementation**

Create `apps/web/src/lib/zoom-math.ts`:

```ts
/** Pure geometry for the photo-detail zoom & pan. No React, no DOM. */

export interface Size {
  width: number;
  height: number;
}

export interface Offset {
  x: number;
  y: number;
}

/** Maximum zoom, as a percentage of the original's 1:1 pixels. */
export const MAX_ZOOM = 100 * 4;

/** Canonical zoom stops above fit, for the +/- buttons. */
const STOPS_ABOVE_FIT = [100, 200, 300, 400];

/** Small tolerance so a slider value sitting on/near a stop still advances. */
const STOP_EPSILON = 0.5;

/**
 * Fit zoom as a percentage. The image is scaled to fit the viewport but never
 * upscaled past 100% (a small photo sits at its native size, centered).
 * Returns 100 before the viewport has been measured.
 */
export function computeFitZoom(photo: Size, viewport: Size): number {
  if (photo.width <= 0 || photo.height <= 0 || viewport.width <= 0 || viewport.height <= 0) {
    return 100;
  }
  const scale = Math.min(viewport.width / photo.width, viewport.height / photo.height, 1);
  return scale * 100;
}

/** Clamp a zoom percentage into [fitZoom, MAX_ZOOM]. */
export function clampZoom(zoom: number, fitZoom: number): number {
  return Math.min(Math.max(zoom, fitZoom), MAX_ZOOM);
}

/** Stops for the +/- buttons: fit, then each 100-step strictly above fit. */
export function computeStops(fitZoom: number): number[] {
  return [fitZoom, ...STOPS_ABOVE_FIT.filter((s) => s > fitZoom)];
}

/** The next stop strictly above the current zoom (caps at the top stop). */
export function nextStop(zoom: number, stops: number[]): number {
  for (const s of stops) {
    if (s > zoom + STOP_EPSILON) return s;
  }
  return stops[stops.length - 1];
}

/** The previous stop strictly below the current zoom (floors at the first stop). */
export function prevStop(zoom: number, stops: number[]): number {
  for (let i = stops.length - 1; i >= 0; i--) {
    if (stops[i] < zoom - STOP_EPSILON) return stops[i];
  }
  return stops[0];
}

/** The rendered CSS size of the image at a given zoom percentage. */
export function scaledSize(photo: Size, zoom: number): Size {
  return { width: (photo.width * zoom) / 100, height: (photo.height * zoom) / 100 };
}

/**
 * Clamp a pan offset (the image center's displacement from the viewport center,
 * in CSS px). Each axis is limited to the scaled image's overflow; an axis where
 * the image is smaller than the viewport locks to 0 (stays centered).
 */
export function clampOffset(offset: Offset, scaled: Size, viewport: Size): Offset {
  const maxX = Math.max(0, (scaled.width - viewport.width) / 2);
  const maxY = Math.max(0, (scaled.height - viewport.height) / 2);
  return {
    x: Math.min(Math.max(offset.x, -maxX), maxX),
    y: Math.min(Math.max(offset.y, -maxY), maxY),
  };
}

/**
 * New offset that keeps the image point under `cursor` fixed across a zoom
 * change. `cursor` is relative to the viewport center, in CSS px. Independent of
 * fit scale because the transform scale ratio equals fromZoom→toZoom ratio.
 *
 *   offset' = cursor - (toZoom / fromZoom) * (cursor - offset)
 */
export function zoomToward(cursor: Offset, fromZoom: number, toZoom: number, offset: Offset): Offset {
  const k = toZoom / fromZoom;
  return {
    x: cursor.x - k * (cursor.x - offset.x),
    y: cursor.y - k * (cursor.y - offset.y),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @lumio/web test src/lib/zoom-math.test.ts`
Expected: PASS — all describe blocks green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/zoom-math.ts apps/web/src/lib/zoom-math.test.ts
git commit -m "feat(zoom): pure zoom-math geometry module with tests"
```

---

## Task 2: `useZoomPan` headless hook

**Files:**
- Create: `apps/web/src/components/photo-grid/use-zoom-pan.ts`

No unit test (DOM/event behavior is browser-verified in Task 5, per the project's
unit-test-pure-logic / browser-verify-UI workflow). The geometry it relies on is
already covered by Task 1.

- [ ] **Step 1: Write the hook**

Create `apps/web/src/components/photo-grid/use-zoom-pan.ts`:

```ts
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from "react";
import {
  clampOffset,
  clampZoom,
  computeFitZoom,
  computeStops,
  nextStop,
  prevStop,
  scaledSize,
  zoomToward,
  type Offset,
  type Size,
} from "@/lib/zoom-math";

/** Below this margin above fit we treat the image as "not zoomed". */
const ZOOM_EPSILON = 0.5;
/** Wheel-delta → zoom factor sensitivity for trackpad pinch / cmd-wheel. */
const PINCH_SENSITIVITY = 100;

export interface ZoomPan {
  viewportRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
  fitZoom: number;
  isZoomed: boolean;
  transform: string;
  cursor: "grab" | "grabbing" | "default";
  setZoom: (zoom: number) => void;
  stepIn: () => void;
  stepOut: () => void;
  reset: () => void;
  handlers: {
    onPointerDown: (e: ReactPointerEvent) => void;
    onPointerMove: (e: ReactPointerEvent) => void;
    onPointerUp: (e: ReactPointerEvent) => void;
    onDoubleClick: (e: ReactMouseEvent) => void;
  };
}

export function useZoomPan(width: number, height: number): ZoomPan {
  const photo = useMemo<Size>(() => ({ width, height }), [width, height]);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState<Size>({ width: 0, height: 0 });
  const [zoom, setZoomRaw] = useState<number | null>(null); // null = follow fit
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);

  const fitZoom = computeFitZoom(photo, viewport);
  const effZoom = zoom ?? fitZoom;
  const isZoomed = effZoom > fitZoom + ZOOM_EPSILON;

  // Latest values for native (non-passive) wheel + pointer math, refreshed after
  // each commit (writing refs during render is disallowed by react-hooks/refs).
  const stateRef = useRef({ photo, viewport, fitZoom, effZoom, offset });
  useEffect(() => {
    stateRef.current = { photo, viewport, fitZoom, effZoom, offset };
  });

  // Cursor position relative to the viewport center, in CSS px.
  const cursorFromCenter = useCallback((clientX: number, clientY: number): Offset => {
    const el = viewportRef.current;
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return { x: clientX - (r.left + r.width / 2), y: clientY - (r.top + r.height / 2) };
  }, []);

  // Apply a zoom change anchored at a cursor point, then clamp the pan.
  const applyZoom = useCallback((target: number, cursor: Offset) => {
    const s = stateRef.current;
    const next = clampZoom(target, s.fitZoom);
    const moved = zoomToward(cursor, s.effZoom, next, s.offset);
    setZoomRaw(next);
    setOffset(clampOffset(moved, scaledSize(s.photo, next), s.viewport));
  }, []);

  const setZoom = useCallback((z: number) => applyZoom(z, { x: 0, y: 0 }), [applyZoom]);
  const stepIn = useCallback(() => {
    const s = stateRef.current;
    applyZoom(nextStop(s.effZoom, computeStops(s.fitZoom)), { x: 0, y: 0 });
  }, [applyZoom]);
  const stepOut = useCallback(() => {
    const s = stateRef.current;
    applyZoom(prevStop(s.effZoom, computeStops(s.fitZoom)), { x: 0, y: 0 });
  }, [applyZoom]);
  const reset = useCallback(() => {
    setZoomRaw(null);
    setOffset({ x: 0, y: 0 });
  }, []);

  // Measure the viewport (and keep it current on resize).
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setViewport((prev) =>
        prev.width === r.width && prev.height === r.height ? prev : { width: r.width, height: r.height },
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Native non-passive wheel: ctrl/cmd-wheel (trackpad pinch) zooms toward the
  // cursor; a plain wheel / 2-finger swipe pans when zoomed. React's onWheel is
  // passive, so preventDefault requires a manual listener.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const s = stateRef.current;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const factor = Math.exp(-e.deltaY / PINCH_SENSITIVITY);
        applyZoom(s.effZoom * factor, cursorFromCenter(e.clientX, e.clientY));
      } else if (s.effZoom > s.fitZoom + ZOOM_EPSILON) {
        e.preventDefault();
        const moved = { x: s.offset.x - e.deltaX, y: s.offset.y - e.deltaY };
        setOffset(clampOffset(moved, scaledSize(s.photo, s.effZoom), s.viewport));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [applyZoom, cursorFromCenter]);

  // Click-drag panning (mouse + trackpad), only when zoomed.
  const dragStart = useRef<{ cursor: Offset; offset: Offset } | null>(null);
  const onPointerDown = useCallback((e: ReactPointerEvent) => {
    const s = stateRef.current;
    if (s.effZoom <= s.fitZoom + ZOOM_EPSILON) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStart.current = { cursor: { x: e.clientX, y: e.clientY }, offset: s.offset };
    setDragging(true);
  }, []);
  const onPointerMove = useCallback((e: ReactPointerEvent) => {
    const start = dragStart.current;
    if (!start) return;
    const s = stateRef.current;
    const moved = {
      x: start.offset.x + (e.clientX - start.cursor.x),
      y: start.offset.y + (e.clientY - start.cursor.y),
    };
    setOffset(clampOffset(moved, scaledSize(s.photo, s.effZoom), s.viewport));
  }, []);
  const onPointerUp = useCallback((e: ReactPointerEvent) => {
    if (!dragStart.current) return;
    dragStart.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setDragging(false);
  }, []);

  // Double-click toggles fit <-> 100% at the cursor.
  const onDoubleClick = useCallback(
    (e: ReactMouseEvent) => {
      const s = stateRef.current;
      if (s.effZoom > s.fitZoom + ZOOM_EPSILON) reset();
      else applyZoom(100, cursorFromCenter(e.clientX, e.clientY));
    },
    [applyZoom, cursorFromCenter, reset],
  );

  const transform = `translate(${offset.x}px, ${offset.y}px) scale(${effZoom / fitZoom})`;
  const cursor = dragging ? "grabbing" : isZoomed ? "grab" : "default";

  return {
    viewportRef,
    zoom: effZoom,
    fitZoom,
    isZoomed,
    transform,
    cursor,
    setZoom,
    stepIn,
    stepOut,
    reset,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onDoubleClick },
  };
}
```

- [ ] **Step 2: Lint and typecheck**

Run: `pnpm --filter @lumio/web lint`
Then: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: no errors for `use-zoom-pan.ts`. (`ZoomControls` and `ZoomableImage` import `MAX_ZOOM` directly from `@/lib/zoom-math`.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/photo-grid/use-zoom-pan.ts
git commit -m "feat(zoom): headless useZoomPan hook (transform, wheel, drag, dblclick)"
```

---

## Task 3: `ZoomControls` overlay

**Files:**
- Create: `apps/web/src/components/photo-grid/zoom-controls.tsx`

- [ ] **Step 1: Write the component**

Create `apps/web/src/components/photo-grid/zoom-controls.tsx`:

```tsx
"use client";

import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { MAX_ZOOM } from "@/lib/zoom-math";

export function ZoomControls({
  zoom,
  min,
  onZoom,
  onStepIn,
  onStepOut,
  canStepIn,
  canStepOut,
}: {
  zoom: number;
  /** Slider minimum — the current fit zoom. */
  min: number;
  onZoom: (zoom: number) => void;
  onStepIn: () => void;
  onStepOut: () => void;
  canStepIn: boolean;
  canStepOut: boolean;
}) {
  return (
    <div className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-full border bg-background/70 px-2 py-1 backdrop-blur">
      <Button
        variant="outline"
        size="icon"
        className="size-7"
        aria-label="Zoom out"
        disabled={!canStepOut}
        onClick={onStepOut}
      >
        <Minus className="size-4" />
      </Button>
      <Slider
        className="w-32"
        min={min}
        max={MAX_ZOOM}
        step={1}
        value={[zoom]}
        onValueChange={(v) => onZoom(v[0])}
        aria-label="Zoom"
      />
      <Button
        variant="outline"
        size="icon"
        className="size-7"
        aria-label="Zoom in"
        disabled={!canStepIn}
        onClick={onStepIn}
      >
        <Plus className="size-4" />
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Lint and typecheck**

Run: `pnpm --filter @lumio/web lint`
Then: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/photo-grid/zoom-controls.tsx
git commit -m "feat(zoom): top-left ZoomControls slider + step buttons"
```

---

## Task 4: `ZoomableImage` + wire into `Lightbox`

**Files:**
- Create: `apps/web/src/components/photo-grid/zoomable-image.tsx`
- Modify: `apps/web/src/components/photo-grid/lightbox.tsx` (remove `LightboxImage` + `NavArrow`, render `ZoomableImage`)

- [ ] **Step 1: Write `ZoomableImage`**

Create `apps/web/src/components/photo-grid/zoomable-image.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { PhotoDTO } from "@lumio/shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { thumbhashDataUrl } from "@/lib/thumbhash-url";
import { useImageLoaded } from "@/lib/use-image-loaded";
import { MAX_ZOOM } from "@/lib/zoom-math";
import { useBlurBox } from "./use-blur-box";
import { useZoomPan } from "./use-zoom-pan";
import { ZoomControls } from "./zoom-controls";

export function ZoomableImage({
  photo,
  hasPrev,
  hasNext,
  step,
}: {
  photo: PhotoDTO;
  hasPrev: boolean;
  hasNext: boolean;
  step: (delta: 1 | -1) => void;
}) {
  const displaySrc = `/api/photos/${photo.id}/display`;
  const originalSrc = `/api/photos/${photo.id}/original`;

  const { containerRef, setImgEl, blurBox } = useBlurBox(photo.width, photo.height, photo.id);
  const zp = useZoomPan(photo.width, photo.height);

  // First zoom past fit: preload + decode the full original, then swap it in.
  // Cache hit means the swap is seamless; geometry is unchanged (same fit size).
  const [hiRes, setHiRes] = useState(false);
  useEffect(() => {
    if (!zp.isZoomed || hiRes) return;
    let cancelled = false;
    const img = new Image();
    img.src = originalSrc;
    img
      .decode()
      .then(() => {
        if (!cancelled) setHiRes(true);
      })
      .catch(() => {
        // Original missing/unreadable: keep showing the rendition (softer at
        // high zoom but still usable).
      });
    return () => {
      cancelled = true;
    };
  }, [zp.isZoomed, hiRes, originalSrc]);
  const src = hiRes ? originalSrc : displaySrc;

  // Track the base display load for the blur-up. `everLoaded` latches true so the
  // display->original src swap can't flash the blur back in.
  const { loaded, ref, onLoad } = useImageLoaded(displaySrc);
  const [everLoaded, setEverLoaded] = useState(false);
  useEffect(() => {
    if (loaded && !everLoaded) setEverLoaded(true);
  }, [loaded, everLoaded]);

  const blurUrl = useMemo(() => thumbhashDataUrl(photo.thumbhash), [photo.thumbhash]);

  // Compose the blur-box and image-loaded callback-refs onto the <img>.
  const setImg = useCallback(
    (node: HTMLImageElement | null) => {
      setImgEl(node);
      ref(node);
    },
    [setImgEl, ref],
  );

  return (
    <div
      ref={zp.viewportRef}
      className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4"
      style={{ touchAction: "none" }}
    >
      <div
        ref={containerRef}
        className="absolute inset-0 flex items-center justify-center"
        style={{ transform: zp.transform, transformOrigin: "center", cursor: zp.cursor }}
        onPointerDown={zp.handlers.onPointerDown}
        onPointerMove={zp.handlers.onPointerMove}
        onPointerUp={zp.handlers.onPointerUp}
        onDoubleClick={zp.handlers.onDoubleClick}
      >
        {/* eslint-disable @next/next/no-img-element */}
        {blurUrl && blurBox && (
          <img
            src={blurUrl}
            alt=""
            aria-hidden
            className="pointer-events-none absolute rounded-sm object-cover transition-opacity duration-500"
            style={{
              left: blurBox.left,
              top: blurBox.top,
              width: blurBox.width,
              height: blurBox.height,
              opacity: everLoaded ? 0 : 1,
            }}
          />
        )}
        <img
          ref={setImg}
          src={src}
          alt={photo.path}
          width={photo.width}
          height={photo.height}
          onLoad={onLoad}
          draggable={false}
          className="max-h-[80vh] w-full select-none object-contain lg:max-h-full lg:w-auto lg:max-w-full"
        />
        {/* eslint-enable @next/next/no-img-element */}
      </div>
      <ZoomControls
        zoom={zp.zoom}
        min={zp.fitZoom}
        onZoom={zp.setZoom}
        onStepIn={zp.stepIn}
        onStepOut={zp.stepOut}
        canStepIn={zp.zoom < MAX_ZOOM - 0.5}
        canStepOut={zp.isZoomed}
      />
      {hasPrev && <NavArrow side="left" label="Previous photo" onClick={() => step(-1)} />}
      {hasNext && <NavArrow side="right" label="Next photo" onClick={() => step(1)} />}
    </div>
  );
}

function NavArrow({
  side,
  label,
  onClick,
}: {
  side: "left" | "right";
  label: string;
  onClick: () => void;
}) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  // The absolute centering (-translate-y-1/2) lives on this wrapper, not the
  // Button: the shadcn Button toggles `translate-y-px` on :active, which writes
  // the same transform and would otherwise wipe out the vertical centering on
  // click. Keeping them on separate elements lets the press-nudge coexist.
  return (
    <div className={cn("absolute top-1/2 z-10 -translate-y-1/2", side === "left" ? "left-2" : "right-2")}>
      <Button
        variant="outline"
        size="icon"
        className="backdrop-blur"
        aria-label={label}
        onClick={onClick}
      >
        <Icon className="size-5" />
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Wire it into `Lightbox` and remove the old image components**

In `apps/web/src/components/photo-grid/lightbox.tsx`:

Replace the imports block (lines 3-15) so `ChevronLeft`/`ChevronRight` and the
now-unused image/blur hooks are dropped and `ZoomableImage` is added. The new
top of the file should read:

```tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PhotoDTO } from "@lumio/shared";
import { createHoldStepper, HOLD_STEP_MS } from "@/lib/hold-key-nav";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import { usePhotoCollection } from "./photo-collection";
import { LightboxSidebar } from "./lightbox-sidebar";
import { FilmStrip } from "./film-strip";
import { ZoomableImage } from "./zoomable-image";
```

In the `Lightbox` render, replace the `<LightboxImage … />` line (line 135) with:

```tsx
          <ZoomableImage key={photo.id} photo={photo} hasPrev={hasPrev} hasNext={hasNext} step={step} />
```

Then delete the now-dead `LightboxImage` function (old lines 146-205), the
`NavArrow` function (old lines 207-228), and any imports they were the sole user
of (`useCallback`, `cn`, `thumbhashDataUrl`, `useImageLoaded`, `useBlurBox`,
`Button`, the lucide chevrons). Keep `useEffect`, `useMemo`, `useRef`,
`useState`, `PhotoDTO`, the hold-stepper, scroll-lock, collection, sidebar, and
film-strip imports (all still used by the `Lightbox` component itself).

- [ ] **Step 3: Lint and typecheck**

Run: `pnpm --filter @lumio/web lint`
Then: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: no errors, and no "unused import/variable" warnings in `lightbox.tsx`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/photo-grid/zoomable-image.tsx apps/web/src/components/photo-grid/lightbox.tsx
git commit -m "feat(zoom): zoomable photo detail with original-swap; wire into Lightbox"
```

---

## Task 5: Full verification (tests, lint, browser)

**Files:** none (verification + any browser-tuning tweaks).

- [ ] **Step 1: Run the full unit test suite**

Run: `pnpm --filter @lumio/web test`
Expected: PASS, including `zoom-math.test.ts`. No regressions in existing tests.

- [ ] **Step 2: Lint and typecheck the whole package**

Run: `pnpm --filter @lumio/web lint`
Then: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Browser verification (per project workflow)**

Start the app (`pnpm --filter @lumio/web dev`), open a photo's detail view, and confirm:

- The top-left control shows `–`, a slider, and `+`.
- Dragging the slider zooms smoothly (1% granularity); the image stays centered when zooming via the slider.
- `+` walks fit → 100 → 200 → 300 → 400; `–` walks back to fit. `–` is disabled at fit; `+` is disabled at 400.
- Trackpad pinch and ⌘/Ctrl-wheel zoom toward the cursor.
- When zoomed, a plain 2-finger swipe / wheel pans; at fit it does nothing.
- When zoomed, click-drag pans and the cursor shows grab/grabbing; panning clamps at the image edges (no empty space revealed).
- Double-click toggles fit ↔ 100% centered on the cursor.
- At high zoom the image becomes crisp once the original loads (watch the network tab fetch `/original` only after the first zoom).
- Navigating to another photo (arrows, film strip, ←/→ keys) resets zoom to fit; closing and reopening resets too.
- Closing on the backdrop still works; the film strip and sidebar are unaffected.

- [ ] **Step 4: Tune and commit any tweaks**

If pinch feels too fast/slow, adjust `PINCH_SENSITIVITY` in `use-zoom-pan.ts`; if
2-finger-swipe pan direction feels inverted, flip the `s.offset.x - e.deltaX` /
`- e.deltaY` signs. Re-verify, then:

```bash
git add -A
git commit -m "fix(zoom): tune pinch sensitivity / pan direction"
```

(Skip this commit if no tweaks were needed.)

---

## Self-Review Notes

- **Spec coverage:** slider + `–`/`+` stops (Task 3, math in Task 1), fit/100%/400% semantics (Task 1 `computeFitZoom`/`clampZoom`/`MAX_ZOOM`), pinch/⌘-wheel/plain-wheel-pan (Task 2 wheel listener), click-drag pan + grab cursor (Task 2 pointer handlers), double-click toggle (Task 2), pan clamping (Task 1 `clampOffset`), original-swap (Task 4), reset-on-navigate via `key={photo.id}` (Task 4), desktop/laptop scope (pointer + wheel, no touch handlers). All covered.
- **Type consistency:** `ZoomPan` (Task 2) is consumed exactly by `ZoomableImage` (Task 4); `ZoomControls` props (Task 3) match the call site in Task 4; `Size`/`Offset` from `zoom-math` (Task 1) are used unchanged in Task 2.
- **No placeholders:** every code step is complete and runnable.
