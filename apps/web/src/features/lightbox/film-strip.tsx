"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { cn } from "@/lib/utils";
import { createWheelStepper } from "@/lib/wheel-step-nav";
import { useRenditions } from "@/features/photo-grid/rendition-context";

// Width of the soft fade applied at a scrollable edge, in px.
const FADE = 28;

/**
 * Horizontal strip of thumbnails for the detail view. The active thumbnail is
 * highlighted and re-centered (by scrolling only the strip, never the window)
 * whenever the current photo changes — arrow keys, arrow buttons, and thumbnail
 * clicks all land here. A fade mask appears on whichever edge still has photos
 * to scroll into view. The scrollbar is always hidden — the strip is navigated
 * via thumbnail clicks, the arrow keys/buttons, and wheel/trackpad. Thumbnails
 * are buttons that open the photo by index.
 */
export function FilmStrip({
  items,
  currentId,
  onPick,
  onStep,
}: {
  items: { id: string; index: number; v: number }[];
  currentId: string;
  onPick: (index: number) => void;
  /** Advance the active photo by ±1 (wheel/trackpad navigation). */
  onStep: (delta: 1 | -1) => void;
}) {
  const r = useRenditions();
  const viewportRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef<HTMLButtonElement>(null);

  // Keep a ref to the latest onStep so the wheel listener can bind once (below)
  // without re-attaching every render. Assigned in an effect, not during render.
  const onStepRef = useRef(onStep);
  useEffect(() => {
    onStepRef.current = onStep;
  });

  // Which edges still have off-screen photos — drives the fade mask.
  const [edges, setEdges] = useState({ left: false, right: false });
  // Whether the strip overflows — switches the row from centered to left-aligned.
  const [overflow, setOverflow] = useState(false);

  const sync = useCallback(() => {
    const c = viewportRef.current;
    if (!c) return;
    const { scrollLeft, clientWidth, scrollWidth } = c;
    const over = scrollWidth - clientWidth > 1;
    const left = scrollLeft > 1;
    const right = scrollLeft + clientWidth < scrollWidth - 1;
    setEdges((p) =>
      p.left === left && p.right === right ? p : { left, right },
    );
    setOverflow((p) => (p === over ? p : over));
  }, []);

  // Center the active thumbnail (scrolling only the strip, before paint to avoid
  // a visible jump), then resync the fade edges to match.
  // `overflow` is a dependency on purpose: every mount starts out
  // `justify-center` (overflow not yet measured), and the first sync() flips it
  // to a left-aligned, scrollable row. Re-running after that flip re-centers
  // against the final layout — without it, entering on a photo far along the
  // strip leaves it off-screen, because the only run measured the centered,
  // not-yet-scrollable layout.
  useLayoutEffect(() => {
    const c = viewportRef.current;
    const el = currentRef.current;
    if (!c || !el) return;
    c.scrollTo({
      left: el.offsetLeft - c.clientWidth / 2 + el.clientWidth / 2,
    });
    sync();
  }, [currentId, items.length, sync, overflow]);

  // Keep the fade in sync when the viewport (and thus overflow) changes.
  useEffect(() => {
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, [sync]);

  // Wheel/trackpad over the strip navigates photos (Lightroom/iCloud-style) instead
  // of scrolling thumbnails. The listener must be non-passive to preventDefault the
  // native horizontal scroll — React's synthetic onWheel is passive at the root, so
  // it can't. The strip still follows the active photo via the auto-center effect.
  useEffect(() => {
    // `c` (the viewport) is always mounted while FilmStrip renders, so the guard
    // is just type-narrowing — the element is stable, so binding once is enough.
    const c = viewportRef.current;
    if (!c) return;
    const stepper = createWheelStepper({ onStep: (d) => onStepRef.current(d) });
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      stepper.handle(e);
    };
    c.addEventListener("wheel", onWheel, { passive: false });
    return () => c.removeEventListener("wheel", onWheel);
  }, []);

  const maskImage =
    edges.left || edges.right
      ? `linear-gradient(to right, ${edges.left ? "transparent" : "#000"}, #000 ${FADE}px, #000 calc(100% - ${FADE}px), ${edges.right ? "transparent" : "#000"})`
      : undefined;

  return (
    <div className="mx-4 mb-4 shrink-0">
      <div className="overflow-hidden rounded-xl border bg-background/40">
        <div
          ref={viewportRef}
          onScroll={sync}
          style={
            maskImage ? { maskImage, WebkitMaskImage: maskImage } : undefined
          }
          className={cn(
            "flex gap-1 overflow-x-auto p-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            // Few photos: center them. Only when they fit — centering an
            // overflowing row would push the first items out of reach.
            !overflow && "justify-center",
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
                  active
                    ? "ring-2 ring-primary"
                    : "opacity-80 hover:opacity-100",
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={r.thumbVersioned(item.id, item.v)}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
