"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { createWheelStepper } from "@/lib/wheel-step-nav";

// Width of the soft fade applied at a scrollable edge, in px.
const FADE = 28;

/**
 * Horizontal strip of thumbnails for the detail view. The active thumbnail is
 * highlighted and re-centered (by scrolling only the strip, never the window)
 * whenever the current photo changes — arrow keys, arrow buttons, and thumbnail
 * clicks all land here. A fade mask appears on whichever edge still has photos
 * to scroll into view. The native scrollbar is hidden; a slim custom scrollbar
 * sits *below* the bordered strip (only when the strip overflows) and can be
 * dragged. Thumbnails are buttons that open the photo by index.
 */
export function FilmStrip({
  items,
  currentId,
  onPick,
  onStep,
}: {
  items: { id: string; index: number }[];
  currentId: string;
  onPick: (index: number) => void;
  /** Advance the active photo by ±1 (wheel/trackpad navigation). */
  onStep: (delta: 1 | -1) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef<HTMLButtonElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

  // Keep a ref to the latest onStep so the wheel listener can bind once (below)
  // without re-attaching every render. Assigned in an effect, not during render.
  const onStepRef = useRef(onStep);
  useEffect(() => {
    onStepRef.current = onStep;
  });

  // Which edges still have off-screen photos — drives the fade mask.
  const [edges, setEdges] = useState({ left: false, right: false });
  // Custom scrollbar geometry: thumb size/offset as track fractions (0..1),
  // and whether the strip is scrollable at all.
  const [bar, setBar] = useState({ size: 1, offset: 0, overflow: false });

  const sync = useCallback(() => {
    const c = viewportRef.current;
    if (!c) return;
    const { scrollLeft, clientWidth, scrollWidth } = c;
    const overflow = scrollWidth - clientWidth > 1;
    const left = scrollLeft > 1;
    const right = scrollLeft + clientWidth < scrollWidth - 1;
    setEdges((p) => (p.left === left && p.right === right ? p : { left, right }));
    const size = overflow ? clientWidth / scrollWidth : 1;
    const offset = overflow ? scrollLeft / scrollWidth : 0;
    setBar((p) =>
      p.size === size && p.offset === offset && p.overflow === overflow
        ? p
        : { size, offset, overflow },
    );
  }, []);

  // Center the active thumbnail (scrolling only the strip, before paint to avoid
  // a visible jump), then resync the fade edges and the scrollbar to match.
  // `bar.overflow` is a dependency on purpose: every mount starts out
  // `justify-center` (overflow not yet measured), and the first sync() flips it
  // to a left-aligned, scrollable row. Re-running after that flip re-centers
  // against the final layout — without it, entering on a photo far along the
  // strip leaves it off-screen, because the only run measured the centered,
  // not-yet-scrollable layout.
  useLayoutEffect(() => {
    const c = viewportRef.current;
    const el = currentRef.current;
    if (!c || !el) return;
    c.scrollTo({ left: el.offsetLeft - c.clientWidth / 2 + el.clientWidth / 2 });
    sync();
  }, [currentId, items.length, sync, bar.overflow]);

  // Keep the fade + scrollbar in sync when the viewport (and thus overflow) changes.
  useEffect(() => {
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, [sync]);

  // Wheel/trackpad over the strip navigates photos (Lightroom/iCloud-style) instead
  // of scrolling thumbnails. The listener must be non-passive to preventDefault the
  // native horizontal scroll — React's synthetic onWheel is passive at the root, so
  // it can't. The strip still follows the active photo via the auto-center effect.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const stepper = createWheelStepper({ onStep: (d) => onStepRef.current(d) });
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      stepper.handle(e);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Drag the custom thumb to scroll the strip.
  function startDrag(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault();
    const c = viewportRef.current;
    const track = trackRef.current;
    if (!c || !track) return;
    const startX = e.clientX;
    const startScroll = c.scrollLeft;
    const travel = track.clientWidth - (c.clientWidth / c.scrollWidth) * track.clientWidth;
    const max = c.scrollWidth - c.clientWidth;
    const onMove = (ev: PointerEvent) => {
      if (travel <= 0) return;
      const next = startScroll + ((ev.clientX - startX) / travel) * max;
      c.scrollLeft = Math.max(0, Math.min(max, next));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  const maskImage =
    edges.left || edges.right
      ? `linear-gradient(to right, ${edges.left ? "transparent" : "#000"}, #000 ${FADE}px, #000 calc(100% - ${FADE}px), ${edges.right ? "transparent" : "#000"})`
      : undefined;

  return (
    <div className="mx-4 mb-4 flex shrink-0 flex-col gap-1">
      <div className="overflow-hidden rounded-xl border bg-background/40">
        <div
          ref={viewportRef}
          onScroll={sync}
          style={maskImage ? { maskImage, WebkitMaskImage: maskImage } : undefined}
          className={cn(
            "flex gap-1 overflow-x-auto p-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            // Few photos: center them. Only when they fit — centering an
            // overflowing row would push the first items out of reach.
            !bar.overflow && "justify-center",
          )}
        >
          {items.map((item) => {
            const active = item.id === currentId;
            return (
              <button
                key={item.id}
                ref={active ? currentRef : undefined}
                type="button"
                onClick={() => onPick(item.index)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  // No transition on the frames: during press-and-hold the active
                  // ring/opacity would animate and visibly lag a step behind.
                  "block size-14 shrink-0 overflow-hidden rounded-xs bg-muted outline-none ring-offset-2 ring-offset-background focus-visible:ring-2 focus-visible:ring-primary",
                  active ? "ring-2 ring-primary" : "opacity-80 hover:opacity-100",
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/thumbnails/${item.id}`} alt="" loading="lazy" className="h-full w-full object-cover" />
              </button>
            );
          })}
        </div>
      </div>

      {/* Reserve the scrollbar's height unconditionally so the strip is the same
          height whether or not it overflows. Overflow is measured only on the
          client (after hydration); the server render and the browser's first
          paint always start at `overflow: false`, so a conditionally-rendered
          track would be absent at first paint and pop in once measured —
          shifting the layout. Keeping the track box always mounted (the muted
          fill + draggable thumb still only show on overflow) removes that shift. */}
      <div
        ref={trackRef}
        className={cn(
          "relative mx-1 h-1.5 rounded-full",
          bar.overflow && "bg-muted",
        )}
      >
        {bar.overflow && (
          <div
            onPointerDown={startDrag}
            style={{ width: `${bar.size * 100}%`, left: `${bar.offset * 100}%` }}
            className="absolute inset-y-0 cursor-grab touch-none rounded-full bg-border transition-colors hover:bg-foreground/40 active:cursor-grabbing"
          />
        )}
      </div>
    </div>
  );
}
