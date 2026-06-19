"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { CheckCircle2, Circle, Images } from "lucide-react";
import type { PhotoDTO, PhotosPage } from "@lumio/shared";
import { computeColumns, rowCount, GRID_GAP, MIN_TILE } from "@/lib/grid-layout";
import { computeSelection } from "@/lib/grid-selection";
import { photoHref } from "@/lib/photo-href";
import type { ThumbnailFit } from "@/lib/use-thumbnail-fit";
import { cn } from "@/lib/utils";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

// Default empty state for the all-photos view. Album views pass their own via
// the `empty` prop since the copy differs (an empty album isn't a worker issue).
const PHOTOS_EMPTY = (
  <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <Images />
      </EmptyMedia>
      <EmptyTitle>No photos yet</EmptyTitle>
      <EmptyDescription>
        Drop photos into your library folder, then rescan to import them.
      </EmptyDescription>
    </EmptyHeader>
  </Empty>
);

const OVERSCAN_ROWS = 3;
// Placeholder tiles rendered before the first page loads. Generous enough to
// fill a large (4K) viewport; the container clips overflow to the viewport, so
// the extras are harmless on smaller screens.
const SKELETON_TILES = 120;

async function fetchPage(endpoint: string, cursor: string | null): Promise<PhotosPage> {
  const params = new URLSearchParams({ limit: "50" });
  if (cursor) params.set("cursor", cursor);
  const res = await fetch(`${endpoint}?${params.toString()}`);
  if (!res.ok) throw new Error("Failed to load photos");
  return res.json();
}

/**
 * One grid tile's photo. Renders the thumbnail at its *cover* size inside an
 * overflow-clipped square, then reaches "contain" by scaling DOWN to the
 * photo's short/long ratio. object-fit can't be CSS-animated, but transforms
 * can — and cover/contain are the same image at two zoom levels — so the
 * cover↔contain toggle becomes a smooth, GPU-accelerated zoom. Scaling down
 * (rather than up from contain) keeps the default cover view pixel-crisp.
 */
function GridThumb({ photo, fit }: { photo: PhotoDTO; fit: ThumbnailFit }) {
  const { width: w, height: h } = photo;
  const valid = w > 0 && h > 0;
  const aspect = valid ? w / h : 1;
  const containScale = valid ? Math.min(w, h) / Math.max(w, h) : 1;
  return (
    <div className="group/tile relative h-full w-full overflow-hidden rounded-sm">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/thumbnails/${photo.id}`}
        alt={photo.path}
        loading="lazy"
        width={w}
        height={h}
        // The element is sized to the cover rectangle (long edge overflows the
        // square and is clipped); contain is the same element scaled down.
        className="absolute left-1/2 top-1/2 max-w-none rounded-sm object-cover transition-[transform,opacity] duration-300 ease-out group-hover/tile:opacity-90"
        style={{
          width: aspect >= 1 ? `${aspect * 100}%` : "100%",
          height: aspect >= 1 ? "100%" : `${(100 / aspect)}%`,
          transform: `translate(-50%, -50%) scale(${fit === "cover" ? 1 : containScale})`,
        }}
      />
    </div>
  );
}

export function PhotoGrid({
  endpoint = "/api/photos",
  albumId,
  empty = PHOTOS_EMPTY,
  fit = "cover",
  selectMode = false,
  selectedIds,
  onSelectionChange,
}: {
  endpoint?: string;
  albumId?: string;
  empty?: React.ReactNode;
  fit?: ThumbnailFit;
  selectMode?: boolean;
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
}) {
  const [photos, setPhotos] = useState<PhotoDTO[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(false);
  const loadingRef = useRef(false);

  // Index of the last plain-clicked tile, used as the shift-range anchor.
  const anchorRef = useRef<number | null>(null);

  function handleTileClick(index: number, e: React.MouseEvent) {
    if (!onSelectionChange) return;
    const next = computeSelection(
      selectedIds ?? new Set<string>(),
      photos.map((p) => p.id),
      index,
      e.shiftKey,
      anchorRef.current,
    );
    if (!e.shiftKey) anchorRef.current = index;
    onSelectionChange(next);
  }

  // Drop the shift-range anchor when leaving select mode so re-entering and
  // shift-clicking doesn't extend from a stale index.
  useEffect(() => {
    if (!selectMode) anchorRef.current = null;
  }, [selectMode]);

  const listRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [offsetTop, setOffsetTop] = useState(0);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el) return;
    setWidth(el.clientWidth);
    setOffsetTop(el.offsetTop);
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const columns = computeColumns(width);
  const tileSize = width > 0 ? (width - GRID_GAP * (columns - 1)) / columns : 0;
  const rows = rowCount(photos.length, columns);

  // Warm-grey placeholder shown until the first page loads. Rendered with pure
  // CSS (auto-fill columns + square tiles) so it needs no measured width — it's
  // in the server HTML and paints on the first frame, even on a fast refresh
  // before hydration. auto-fill with the same MIN_TILE/GRID_GAP yields the same
  // column count as the real grid, so the swap to real photos is seamless.
  const showSkeleton = photos.length === 0 && !done && !error;

  const loadMore = useCallback(async () => {
    if (loadingRef.current || done) return;
    loadingRef.current = true;
    setError(false);
    try {
      const page = await fetchPage(endpoint, cursor);
      setPhotos((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
      if (!page.nextCursor) setDone(true);
    } catch {
      setError(true);
    } finally {
      loadingRef.current = false;
    }
  }, [endpoint, cursor, done]);

  useEffect(() => {
    void loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const virtualizer = useWindowVirtualizer({
    count: rows,
    estimateSize: () => tileSize + GRID_GAP,
    overscan: OVERSCAN_ROWS,
    scrollMargin: offsetTop,
  });

  useEffect(() => {
    virtualizer.measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tileSize, columns]);

  const items = virtualizer.getVirtualItems();
  // Fetch more while the last loaded row is within OVERSCAN of the end. This
  // fills the viewport on first load, then becomes scroll-driven once loaded
  // rows exceed the visible area (the last virtual row index drops below the
  // threshold). The loadingRef guard + `done` prevent redundant fetches.
  useEffect(() => {
    const last = items[items.length - 1];
    if (last && last.index >= rows - OVERSCAN_ROWS) void loadMore();
  }, [items, rows, loadMore]);

  if (done && photos.length === 0) {
    return <>{empty}</>;
  }

  if (showSkeleton) {
    return (
      <div ref={listRef} style={{ maxHeight: "100vh", overflow: "hidden" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(auto-fill, minmax(${MIN_TILE}px, 1fr))`,
            gap: GRID_GAP,
          }}
        >
          {Array.from({ length: SKELETON_TILES }).map((_, i) => (
            <div key={i} className="aspect-square rounded-sm bg-skeleton" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div ref={listRef}>
      <div style={{ height: virtualizer.getTotalSize(), width: "100%", position: "relative" }}>
        {items.map((vrow) => {
          const start = vrow.index * columns;
          const rowPhotos = photos.slice(start, start + columns);
          return (
            <div
              key={vrow.key}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: tileSize,
                transform: `translateY(${vrow.start - virtualizer.options.scrollMargin}px)`,
                display: "grid",
                gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                gridAutoRows: `${tileSize}px`,
                gap: GRID_GAP,
              }}
            >
              {rowPhotos.map((photo, i) => {
                const globalIndex = start + i;
                const thumb = <GridThumb photo={photo} fit={fit} />;

                if (selectMode) {
                  const isSelected = selectedIds?.has(photo.id) ?? false;
                  return (
                    <button
                      key={photo.id}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={(e) => handleTileClick(globalIndex, e)}
                      className={cn(
                        "relative block h-full select-none rounded-sm outline-none focus:outline-none focus-visible:outline-none",
                        isSelected && "ring-2 ring-inset ring-primary",
                      )}
                    >
                      <div className={cn("h-full w-full transition-transform", isSelected && "scale-[0.92]")}>
                        {thumb}
                      </div>
                      <span className="absolute left-2 top-2 rounded-full bg-background text-foreground">
                        {isSelected ? (
                          <CheckCircle2 className="size-5 text-primary" />
                        ) : (
                          <Circle className="size-5 text-muted-foreground" />
                        )}
                      </span>
                    </button>
                  );
                }

                return (
                  <Link
                    key={photo.id}
                    href={photoHref(photo.id, albumId)}
                    className="block h-full outline-none focus:outline-none focus-visible:outline-none"
                  >
                    {thumb}
                  </Link>
                );
              })}
            </div>
          );
        })}
      </div>
      {error && (
        <div className="py-4 text-center">
          <button onClick={() => void loadMore()} className="text-sm text-muted-foreground underline">
            Failed to load — retry
          </button>
        </div>
      )}
    </div>
  );
}
