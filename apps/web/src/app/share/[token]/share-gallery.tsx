"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, X, ChevronLeft, ChevronRight } from "lucide-react";
import type { PhotoDTO, PhotosPage } from "@lumio/shared";
import { thumbhashDataUrl } from "@/lib/thumbhash-url";
import { renditionVersion } from "@/lib/rendition-url";
import { Button } from "@/components/ui/button";
import {
  shareThumbUrl,
  shareDisplayUrl,
  shareDownloadUrl,
  shareDownloadAllUrl,
  sharePhotosEndpoint,
} from "@/lib/share-url";

const PAGE_SIZE = 100;

export function ShareGallery({ token, title }: { token: string; title: string | null }) {
  const [photos, setPhotos] = useState<PhotoDTO[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [viewer, setViewer] = useState<number | null>(null);
  const loadingRef = useRef(false);

  const loadMore = useCallback(async () => {
    if (loadingRef.current) return;
    if (total !== null && photos.length >= total) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const url = `${sharePhotosEndpoint(token)}?limit=${PAGE_SIZE}&offset=${photos.length}`;
      const res = await fetch(url);
      if (!res.ok) return;
      const page = (await res.json()) as PhotosPage;
      setPhotos((prev) => [...prev, ...page.items]);
      setTotal(page.total);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [photos.length, token, total]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyboard nav in the viewer.
  useEffect(() => {
    if (viewer === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setViewer(null);
      if (e.key === "ArrowRight") setViewer((i) => (i === null ? i : Math.min(photos.length - 1, i + 1)));
      if (e.key === "ArrowLeft") setViewer((i) => (i === null ? i : Math.max(0, i - 1)));
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [viewer, photos.length]);

  // Only after the first page lands (total known) and more remain — avoids a
  // "Load more" flash before the initial fetch resolves.
  const hasMore = total !== null && photos.length < total;
  const current = viewer !== null ? photos[viewer] : null;

  return (
    <main className="mx-auto max-w-screen-2xl px-4 py-6">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{title ?? "Shared photos"}</h1>
          {total !== null && (
            <p className="text-sm text-muted-foreground">
              {total} photo{total === 1 ? "" : "s"}
            </p>
          )}
        </div>
        {total !== null && total > 0 && (
          <Button asChild variant="outline" size="sm">
            <a href={shareDownloadAllUrl(token)} download>
              <Download aria-hidden />
              Download all
            </a>
          </Button>
        )}
      </header>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {photos.map((photo, i) => {
          const blur = thumbhashDataUrl(photo.thumbhash);
          return (
            <button
              key={photo.id}
              type="button"
              onClick={() => setViewer(i)}
              className="group relative aspect-square overflow-hidden rounded-lg bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="View photo"
            >
              {blur && (
                <span
                  aria-hidden
                  className="absolute inset-0 bg-cover bg-center"
                  style={{ backgroundImage: `url(${blur})` }}
                />
              )}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={shareThumbUrl(token, photo.id, renditionVersion(photo.updatedAt))}
                alt=""
                loading="lazy"
                className="relative h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
              />
            </button>
          );
        })}
      </div>

      {hasMore && (
        <div className="mt-6 flex justify-center">
          <Button variant="outline" onClick={() => void loadMore()} disabled={loading}>
            {loading ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}

      {current && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Photo viewer"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90"
        >
          <button
            type="button"
            onClick={() => setViewer(null)}
            className="absolute right-4 top-4 z-10 rounded-full p-2 text-white/80 hover:bg-white/10 hover:text-white"
            aria-label="Close"
            autoFocus
          >
            <X aria-hidden />
          </button>
          {viewer !== null && viewer > 0 && (
            <button
              type="button"
              onClick={() => setViewer((i) => (i === null ? i : i - 1))}
              className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full p-2 text-white/80 hover:bg-white/10 hover:text-white"
              aria-label="Previous"
            >
              <ChevronLeft aria-hidden />
            </button>
          )}
          {viewer !== null && viewer < photos.length - 1 && (
            <button
              type="button"
              onClick={() => setViewer((i) => (i === null ? i : i + 1))}
              className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full p-2 text-white/80 hover:bg-white/10 hover:text-white"
              aria-label="Next"
            >
              <ChevronRight aria-hidden />
            </button>
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={shareDisplayUrl(token, current.id, renditionVersion(current.updatedAt))}
            alt={`Shared photo ${viewer !== null ? viewer + 1 : ""} of ${photos.length}`}
            className="max-h-[90dvh] max-w-[92vw] object-contain"
          />
          <a
            href={shareDownloadUrl(token, current.id)}
            download
            className="absolute bottom-4 right-4 flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm text-white hover:bg-white/20"
          >
            <Download className="size-4" aria-hidden />
            Download
          </a>
        </div>
      )}
    </main>
  );
}
