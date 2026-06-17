"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import type { PhotoDTO, PhotosPage } from "@lumio/shared";
import { computeColumns, rowCount, GRID_GAP } from "@/lib/grid-layout";

const OVERSCAN_ROWS = 3;

async function fetchPage(cursor: string | null): Promise<PhotosPage> {
  const params = new URLSearchParams({ limit: "50" });
  if (cursor) params.set("cursor", cursor);
  const res = await fetch(`/api/photos?${params.toString()}`);
  if (!res.ok) throw new Error("Failed to load photos");
  return res.json();
}

export function PhotoGrid() {
  const [photos, setPhotos] = useState<PhotoDTO[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [error, setError] = useState(false);
  const loadingRef = useRef(false);

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

  const loadMore = useCallback(async () => {
    if (loadingRef.current || done) return;
    loadingRef.current = true;
    setError(false);
    try {
      const page = await fetchPage(cursor);
      setPhotos((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
      if (!page.nextCursor) setDone(true);
    } catch {
      setError(true);
    } finally {
      loadingRef.current = false;
    }
  }, [cursor, done]);

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
  useEffect(() => {
    const last = items[items.length - 1];
    if (last && last.index >= rows - OVERSCAN_ROWS) void loadMore();
  }, [items, rows, loadMore]);

  if (done && photos.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        No photos yet. Run the worker to ingest <code>/photos</code>.
      </p>
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
                gap: GRID_GAP,
              }}
            >
              {rowPhotos.map((photo) => (
                <Link key={photo.id} href={`/photo/${photo.id}`} className="block h-full">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/thumbnails/${photo.id}`}
                    alt={photo.path}
                    loading="lazy"
                    width={photo.width}
                    height={photo.height}
                    className="h-full w-full rounded-md object-cover transition-opacity hover:opacity-90"
                  />
                </Link>
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
