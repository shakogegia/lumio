"use client";

import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { Images } from "lucide-react";
import { computeColumns, rowCount, GRID_GAP } from "@/lib/grid-layout";
import { computeSelection } from "@/lib/grid-selection";
import type { PhotoDTO } from "@lumio/shared";
import type { GridViewMode } from "@/lib/use-grid-view";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { usePhotoPages } from "./use-photo-pages";
import { PhotoGridSkeleton } from "./photo-grid-skeleton";
import { PhotoGridTile } from "./photo-grid-tile";

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

export type PhotoGridHandle = {
  /** Merge `patch` into every loaded photo whose id is in `ids` (e.g. a new colorLabel). */
  patchPhotos: (ids: Set<string>, patch: Partial<PhotoDTO>) => void;
};

export function PhotoGrid({
  endpoint = "/api/photos",
  albumId,
  empty = PHOTOS_EMPTY,
  mode = "fill",
  params,
  hrefFor,
  selectMode = false,
  selectedIds,
  onSelectionChange,
  apiRef,
}: {
  endpoint?: string;
  albumId?: string;
  empty?: React.ReactNode;
  mode?: GridViewMode;
  params?: URLSearchParams;
  /** Detail-route href for a tile; defaults to the album/library scope. The
   *  search view overrides it to carry the search filter (so the film strip
   *  navigates the results). */
  hrefFor?: (id: string) => string;
  selectMode?: boolean;
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  /** Imperative handle for in-place photo updates (optimistic label tinting). */
  apiRef?: React.Ref<PhotoGridHandle>;
}) {
  const { photos, done, error, loadMore, patchPhotos } = usePhotoPages(endpoint, params);
  useImperativeHandle(apiRef, () => ({ patchPhotos }), [patchPhotos]);

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
    return <PhotoGridSkeleton listRef={listRef} />;
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
              {rowPhotos.map((photo, i) => (
                <PhotoGridTile
                  key={photo.id}
                  photo={photo}
                  mode={mode}
                  albumId={albumId}
                  hrefFor={hrefFor}
                  selectMode={selectMode}
                  isSelected={selectedIds?.has(photo.id) ?? false}
                  index={start + i}
                  onTileClick={handleTileClick}
                />
              ))}
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
