"use client";

import { useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { Images } from "lucide-react";
import { rowCount, GRID_GAP, DEFAULT_COLUMNS, PHOTO_PAGE_SIZE } from "@/lib/grid-layout";
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
import { usePhotoCollection } from "./photo-collection";
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
  /** Drop every loaded photo whose id is in `ids` (e.g. after moving to Trash). */
  removePhotos: (ids: Set<string>) => void;
};

export function PhotoGrid({
  empty = PHOTOS_EMPTY,
  mode = "fill",
  columns: columnsProp = DEFAULT_COLUMNS,
  selectedIds,
  onSelectionChange,
  apiRef,
}: {
  empty?: React.ReactNode;
  mode?: GridViewMode;
  columns?: number;
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  apiRef?: React.Ref<PhotoGridHandle>;
}) {
  const columns = Math.max(1, columnsProp);
  const {
    total, photoAt, getLoadedIds, ensureRange, error, retry,
    patchPhotos, removePhotos, open, urlForId, enableLightbox,
  } = usePhotoCollection();
  useImperativeHandle(apiRef, () => ({ patchPhotos, removePhotos }), [patchPhotos, removePhotos]);

  // Index of the last plain-clicked tile, used as the shift-range anchor.
  const anchorRef = useRef<number | null>(null);

  function handleTileClick(index: number, e: React.MouseEvent) {
    if (!onSelectionChange) return;
    // getLoadedIds() is sparse (holes for unloaded indices); computeSelection
    // skips holes, so a shift-range across an unloaded gap selects only loaded ids.
    const next = computeSelection(
      selectedIds ?? new Set<string>(),
      getLoadedIds(),
      index,
      e.shiftKey,
      anchorRef.current,
    );
    if (!e.shiftKey) anchorRef.current = index;
    onSelectionChange(next);
  }

  const [width, setWidth] = useState(0);
  const [offsetTop, setOffsetTop] = useState(0);
  const roRef = useRef<ResizeObserver | null>(null);

  // Callback ref so measurement re-attaches whenever the underlying node changes
  // (skeleton → real grid). A one-shot effect would keep observing the detached
  // skeleton and miss window resizes until a refresh.
  const measureRef = useCallback((el: HTMLDivElement | null) => {
    roRef.current?.disconnect();
    if (!el) {
      roRef.current = null;
      return;
    }
    const measure = () => {
      setWidth(el.clientWidth);
      setOffsetTop(el.offsetTop);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    roRef.current = ro;
  }, []);

  const tileSize = width > 0 ? (width - GRID_GAP * (columns - 1)) / columns : 0;
  const rows = rowCount(total ?? 0, columns);

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

  // Fetch the pages covering the visible rows plus ~2 pages of read-ahead, so
  // content streams in before the user reaches it (and holes fill when the
  // scrollbar is dragged). The hook dedupes and caps in-flight requests.
  const prefetchRows = Math.ceil((2 * PHOTO_PAGE_SIZE) / columns);
  useEffect(() => {
    if (items.length === 0) return;
    const firstRow = items[0]!.index;
    const lastRow = items[items.length - 1]!.index;
    ensureRange(firstRow * columns, (lastRow + prefetchRows) * columns + (columns - 1));
  }, [items, columns, prefetchRows, ensureRange]);

  if (total === 0) {
    return <>{empty}</>;
  }

  // First paint, before `total` is known: the CSS skeleton grid (server-rendered).
  if (total === null) {
    return <PhotoGridSkeleton listRef={measureRef} columns={columns} />;
  }

  return (
    <div ref={measureRef}>
      <div
        style={{
          height: virtualizer.getTotalSize(),
          width: "100%",
          position: "relative",
        }}
      >
        {items.map((vrow) => {
          const start = vrow.index * columns;
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
              {Array.from({ length: columns }, (_, i) => {
                const idx = start + i;
                // Past the last photo (the final partial row's trailing cells):
                // an empty cell — no skeleton, just the page background.
                if (idx >= total) return <div key={i} aria-hidden />;
                const photo = photoAt(idx);
                // Unloaded cell: a skeleton placeholder rendered as a grid item in
                // the SAME grid as the tiles, so it lands pixel-for-pixel where the
                // photo will (a tiled background drifts from the CSS-grid tracks at
                // fractional widths — and only at some column counts).
                if (!photo) return <div key={i} aria-hidden className="rounded-sm bg-muted" />;
                return (
                  <PhotoGridTile
                    key={photo.id}
                    photo={photo}
                    mode={mode}
                    index={idx}
                    onOpen={enableLightbox ? open : undefined}
                    urlForId={urlForId}
                    isSelected={selectedIds?.has(photo.id) ?? false}
                    onTileClick={handleTileClick}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
      {error && (
        <div className="py-4 text-center">
          <button onClick={() => retry()} className="text-sm text-muted-foreground underline">
            Failed to load — retry
          </button>
        </div>
      )}
    </div>
  );
}
