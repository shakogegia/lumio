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
} from "./zoom-math";

/** Below this margin above fit we treat the image as "not zoomed". */
const ZOOM_EPSILON = 0.5;
/** Wheel-delta → zoom factor sensitivity for trackpad pinch / cmd-wheel. */
const PINCH_SENSITIVITY = 100;

export interface ZoomPan {
  viewportRef: React.RefObject<HTMLDivElement | null>;
  /** Measured viewport size (CSS px); 0×0 until first measured. */
  viewport: Size;
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
    onPointerCancel: (e: ReactPointerEvent) => void;
    onDoubleClick: (e: ReactMouseEvent) => void;
  };
}

export function useZoomPan(width: number, height: number, enabled = true): ZoomPan {
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
  const stateRef = useRef({ photo, viewport, fitZoom, effZoom, offset, enabled });
  useEffect(() => {
    stateRef.current = { photo, viewport, fitZoom, effZoom, offset, enabled };
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

  // Keep the pan in-bounds when the viewport resizes (e.g. window resize while zoomed).
  useEffect(() => {
    const reclamp = (vp: Size) => {
      const s = stateRef.current;
      setOffset((prev) => clampOffset(prev, scaledSize(s.photo, s.effZoom), vp));
    };
    reclamp(viewport);
  }, [viewport]);

  // Native non-passive wheel: ctrl/cmd-wheel (trackpad pinch) zooms toward the
  // cursor; a plain wheel / 2-finger swipe pans when zoomed. React's onWheel is
  // passive, so preventDefault requires a manual listener.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const s = stateRef.current;
      // Zoom disabled (e.g. crop mode): swallow the pinch so the page doesn't
      // zoom, but otherwise ignore the wheel.
      if (!s.enabled) {
        if (e.ctrlKey || e.metaKey) e.preventDefault();
        return;
      }
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
  // An OS/browser pointer-cancel (e.g. window loses focus) ends the drag too;
  // capture is released automatically on cancel, so don't call releasePointerCapture.
  const onPointerCancel = useCallback(() => {
    if (!dragStart.current) return;
    dragStart.current = null;
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
    viewport,
    zoom: effZoom,
    fitZoom,
    isZoomed,
    transform,
    cursor,
    setZoom,
    stepIn,
    stepOut,
    reset,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onDoubleClick },
  };
}
