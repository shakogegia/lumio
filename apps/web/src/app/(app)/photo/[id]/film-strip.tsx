"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PhotoStripItem } from "@lumio/shared";
import { cn } from "@/lib/utils";

// Width of the soft fade applied at a scrollable edge, in px.
const FADE = 28;

/**
 * Horizontal strip of thumbnails for the detail view. The active thumbnail is
 * highlighted and re-centered (by scrolling only the strip, never the window)
 * whenever the current photo changes — arrow keys, arrow buttons, and thumbnail
 * clicks all land here. A fade mask appears on whichever edge still has photos
 * to scroll into view. The native scrollbar is hidden; a slim custom scrollbar
 * sits *below* the bordered strip (only when the strip overflows) and can be
 * dragged. Thumbnails are links; prefetch is off so we don't prefetch ~50 routes
 * at once (the prev/next arrows keep prefetch).
 */
export function FilmStrip({
  items,
  currentId,
  hrefFor,
  replace = false,
}: {
  items: PhotoStripItem[];
  currentId: string;
  hrefFor: (id: string) => string;
  /** Replace history instead of pushing — used inside the modal so Escape/back
   *  closes the overlay rather than stepping back through visited photos. */
  replace?: boolean;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef<HTMLAnchorElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);

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
  useLayoutEffect(() => {
    const c = viewportRef.current;
    const el = currentRef.current;
    if (!c || !el) return;
    c.scrollTo({ left: el.offsetLeft - c.clientWidth / 2 + el.clientWidth / 2 });
    sync();
  }, [currentId, items.length, sync]);

  // Keep the fade + scrollbar in sync when the viewport (and thus overflow) changes.
  useEffect(() => {
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, [sync]);

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
              <Link
                key={item.id}
                ref={active ? currentRef : undefined}
                href={hrefFor(item.id)}
                replace={replace}
                prefetch={false}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "block size-14 shrink-0 overflow-hidden rounded-xs outline-none ring-offset-2 ring-offset-background transition focus-visible:ring-2 focus-visible:ring-primary",
                  active ? "ring-2 ring-primary" : "opacity-80 hover:opacity-100",
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={`/api/thumbnails/${item.id}`}
                  alt=""
                  loading="lazy"
                  className="h-full w-full object-cover"
                />
              </Link>
            );
          })}
        </div>
      </div>

      {bar.overflow && (
        <div ref={trackRef} className="relative mx-1 h-1.5 rounded-full bg-muted">
          <div
            onPointerDown={startDrag}
            style={{ width: `${bar.size * 100}%`, left: `${bar.offset * 100}%` }}
            className="absolute inset-y-0 cursor-grab touch-none rounded-full bg-border transition-colors hover:bg-foreground/40 active:cursor-grabbing"
          />
        </div>
      )}
    </div>
  );
}
