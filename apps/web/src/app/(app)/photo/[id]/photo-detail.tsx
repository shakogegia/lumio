"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { AlbumSummaryDTO, PhotoDTO, PhotoNeighbors } from "@lumio/shared";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { photoHref } from "@/lib/photo-href";
import { FilmStrip } from "./film-strip";

export function PhotoDetail({
  photo,
  regularAlbums,
  neighbors,
  albumId,
}: {
  photo: PhotoDTO;
  regularAlbums: AlbumSummaryDTO[];
  neighbors: PhotoNeighbors;
  albumId: string | null;
}) {
  const router = useRouter();
  const filename = photo.path.split("/").pop() || photo.path;
  const camera =
    [photo.exif.cameraMake, photo.exif.cameraModel].filter(Boolean).join(" ") ||
    "—";

  const prevHref = neighbors.prevId ? photoHref(neighbors.prevId, albumId) : null;
  const nextHref = neighbors.nextId ? photoHref(neighbors.nextId, albumId) : null;

  // Arrow-key navigation. Lives here (not in RouteOverlay) so it works on the
  // standalone page as well as in the modal. Ignore keys while typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowLeft" && prevHref) router.push(prevHref);
      if (e.key === "ArrowRight" && nextHref) router.push(nextHref);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [prevHref, nextHref, router]);

  // The layout fills its container edge to edge (full viewport height, padding
  // owned by each side rather than an outer frame), so the standalone page and
  // the modal overlay look identical. The image side has no background of its
  // own: on the standalone page it shows the opaque body behind it; inside the
  // intercepted-route overlay it shows that overlay's frosted-glass material,
  // which is what makes only the image side read as translucent in the modal.
  return (
    <div className="flex flex-col lg:h-dvh lg:flex-row">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="relative flex min-h-0 flex-1 items-center justify-center p-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/photos/${photo.id}/display`}
            alt={photo.path}
            className="max-h-[80vh] w-full object-contain lg:max-h-full lg:w-auto lg:max-w-full"
          />
          {prevHref && <NavArrow side="left" href={prevHref} label="Previous photo" />}
          {nextHref && <NavArrow side="right" href={nextHref} label="Next photo" />}
        </div>
        {neighbors.strip.length > 1 && (
          <FilmStrip
            items={neighbors.strip}
            currentId={photo.id}
            hrefFor={(id) => photoHref(id, albumId)}
          />
        )}
      </div>
      <aside className="w-full shrink-0 border-t bg-background p-4 text-sm lg:h-dvh lg:w-80 lg:overflow-y-auto lg:border-t-0 lg:border-l">
        <div className="space-y-1">
          <h2 className="font-medium break-all">{filename}</h2>
          <div className="flex items-center gap-2">
            <Badge>{photo.source}</Badge>
            <span className="text-muted-foreground">
              {photo.width}×{photo.height}
            </span>
          </div>
        </div>

        <Separator className="my-4" />

        <div className="space-y-3">
          <Row label="Taken" value={photo.takenAt ?? "—"} />
          <Row label="Camera" value={camera} />
          <Row label="Hash" value={photo.hash ?? "—"} />
        </div>

        {regularAlbums.length > 0 && (
          <>
            <Separator className="my-4" />
            <AlbumMembership photo={photo} regularAlbums={regularAlbums} />
          </>
        )}

        <Separator className="my-4" />

        <details className="group">
          <summary className="cursor-pointer text-muted-foreground select-none">
            Show all EXIF
          </summary>
          <pre className="mt-2 overflow-auto rounded bg-muted p-2 text-xs">
            {JSON.stringify(photo.exif, null, 2)}
          </pre>
        </details>
      </aside>
    </div>
  );
}

function NavArrow({
  side,
  href,
  label,
}: {
  side: "left" | "right";
  href: string;
  label: string;
}) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <Link
      href={href}
      aria-label={label}
      className={cn(
        "absolute top-1/2 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-background/70 text-foreground shadow-sm backdrop-blur transition hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        side === "left" ? "left-2" : "right-2",
      )}
    >
      <Icon className="size-6" />
    </Link>
  );
}

function AlbumMembership({
  photo,
  regularAlbums,
}: {
  photo: PhotoDTO;
  regularAlbums: AlbumSummaryDTO[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);

  async function toggle(album: AlbumSummaryDTO) {
    const isMember = photo.albumIds?.includes(album.id) ?? false;
    setPending(album.id);
    try {
      if (isMember) {
        await fetch(`/api/albums/${album.id}/photos/${photo.id}`, {
          method: "DELETE",
        });
      } else {
        await fetch(`/api/albums/${album.id}/photos`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ photoIds: [photo.id] }),
        });
      }
      router.refresh();
    } finally {
      setPending(null);
    }
  }

  return (
    <div>
      <p className="mb-2 font-medium">Albums</p>
      <div className="space-y-2">
        {regularAlbums.map((album) => {
          const checked = photo.albumIds?.includes(album.id) ?? false;
          return (
            <label
              key={album.id}
              className="flex cursor-pointer items-center gap-2"
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={pending !== null}
                onChange={() => void toggle(album)}
                className="h-4 w-4 rounded border-input accent-primary"
              />
              <span>{album.name}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate text-right">{value}</span>
    </div>
  );
}
