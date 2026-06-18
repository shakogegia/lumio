"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import type { PhotoStripItem } from "@lumio/shared";
import { cn } from "@/lib/utils";

/**
 * Horizontal strip of thumbnails for the detail view. The active thumbnail is
 * highlighted and re-centered (by scrolling only the strip container, never the
 * window) whenever the current photo changes — arrow keys, arrow buttons, and
 * thumbnail clicks all land here. Thumbnails are links; prefetch is off so we
 * don't prefetch ~50 routes at once (the prev/next arrows keep prefetch).
 */
export function FilmStrip({
  items,
  currentId,
  hrefFor,
}: {
  items: PhotoStripItem[];
  currentId: string;
  hrefFor: (id: string) => string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const el = currentRef.current;
    if (!container || !el) return;
    const left = el.offsetLeft - container.clientWidth / 2 + el.clientWidth / 2;
    container.scrollTo({ left });
  }, [currentId]);

  return (
    <div
      ref={containerRef}
      className="flex shrink-0 gap-1 overflow-x-auto border-t bg-background/40 p-2"
    >
      {items.map((item) => {
        const active = item.id === currentId;
        return (
          <Link
            key={item.id}
            ref={active ? currentRef : undefined}
            href={hrefFor(item.id)}
            prefetch={false}
            aria-current={active ? "true" : undefined}
            className={cn(
              "block size-14 shrink-0 overflow-hidden rounded-sm outline-none ring-offset-2 ring-offset-background transition",
              active
                ? "ring-2 ring-primary"
                : "opacity-60 hover:opacity-100",
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
  );
}
