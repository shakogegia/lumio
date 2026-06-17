"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PhotoDTO, PhotosPage } from "@lumio/shared";
import { Card } from "@/components/ui/card";

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
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false);
  const sentinel = useRef<HTMLDivElement>(null);

  const loadMore = useCallback(async () => {
    if (loadingRef.current || done) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const page = await fetchPage(cursor);
      setPhotos((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
      if (!page.nextCursor) setDone(true);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [cursor, done]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) void loadMore();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore]);

  return (
    <div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
        {photos.map((photo) => (
          <Link key={photo.id} href={`/photo/${photo.id}`}>
            <Card className="overflow-hidden p-0 transition-shadow hover:shadow-md">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/thumbnails/${photo.id}`}
                alt={photo.path}
                loading="lazy"
                width={photo.width}
                height={photo.height}
                className="aspect-square w-full object-cover"
              />
            </Card>
          </Link>
        ))}
      </div>
      <div ref={sentinel} className="h-10" />
      {loading && <p className="py-4 text-center text-sm text-muted-foreground">Loading…</p>}
      {done && photos.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No photos yet. Run the worker to ingest <code>/photos</code>.
        </p>
      )}
    </div>
  );
}
