"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import type { AlbumSummaryDTO, PhotoDTO, PhotoNeighbors } from "@lumio/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { photoHref } from "@/lib/photo-href";
import { exifEntries, filterExifEntries } from "@/lib/exif-entries";
import { setHoldNavTarget } from "@/lib/hold-key-nav";
import { FilmStrip } from "./film-strip";

export function PhotoDetail({
  photo,
  regularAlbums,
  neighbors,
  albumId,
  overlay = false,
}: {
  photo: PhotoDTO;
  regularAlbums: AlbumSummaryDTO[];
  neighbors: PhotoNeighbors;
  albumId: string | null;
  /** Rendered inside the intercepted-route modal. When true, prev/next replace
   *  history instead of pushing, so Escape/back closes the overlay to the grid
   *  rather than stepping back through every photo visited in the modal. */
  overlay?: boolean;
}) {
  const router = useRouter();
  const filename = photo.path.split("/").pop() || photo.path;
  const camera =
    [photo.exif.cameraMake, photo.exif.cameraModel].filter(Boolean).join(" ") ||
    "—";
  const metadata = exifEntries(photo.exif);

  const prevHref = neighbors.prevId ? photoHref(neighbors.prevId, albumId) : null;
  const nextHref = neighbors.nextId ? photoHref(neighbors.nextId, albumId) : null;

  // Arrow-key navigation, with press-and-hold support. The photo page remounts
  // on every navigation (intercepted/parallel route), so the hold loop can't
  // live in this component — it's owned by a module-level controller that
  // outlives the remounts. Here we just keep that controller pointed at the
  // photo on screen. `scroll: false` keeps the swap in place (no focus jump, no
  // scroll-to-top). See `@/lib/hold-key-nav` for the full story.
  useEffect(() => {
    return setHoldNavTarget({
      prevHref,
      nextHref,
      navigate: (href) =>
        overlay
          ? router.replace(href, { scroll: false })
          : router.push(href, { scroll: false }),
    });
  }, [prevHref, nextHref, overlay, router]);

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
          {prevHref && (
            <NavArrow side="left" href={prevHref} label="Previous photo" replace={overlay} />
          )}
          {nextHref && (
            <NavArrow side="right" href={nextHref} label="Next photo" replace={overlay} />
          )}
        </div>
        {neighbors.strip.length > 0 && (
          <FilmStrip
            items={neighbors.strip}
            currentId={photo.id}
            hrefFor={(id) => photoHref(id, albumId)}
            replace={overlay}
          />
        )}
      </div>
      <aside className="w-full shrink-0 border-t bg-background p-4 text-sm lg:h-dvh lg:w-80 lg:overflow-y-auto lg:border-t-0 lg:border-l">
        <div className="space-y-1">
          <h2 className="font-medium break-all">{filename}</h2>
          <p className="text-muted-foreground">
            {photo.width}×{photo.height}
          </p>
        </div>

        <Tabs defaultValue="info" className="mt-4">
          <TabsList className="w-full">
            <TabsTrigger value="info">Info</TabsTrigger>
            <TabsTrigger value="exif">EXIF</TabsTrigger>
          </TabsList>

          <TabsContent value="info" className="space-y-4">
            <div className="space-y-3">
              <Row label="Source" value={<Badge>{photo.source}</Badge>} />
              <Row label="Taken" value={photo.takenAt ?? "—"} />
              <Row label="Camera" value={camera} />
              <Row label="Hash" value={photo.hash ?? "—"} />
            </div>
            {regularAlbums.length > 0 && (
              <>
                <Separator />
                <AlbumMembership photo={photo} regularAlbums={regularAlbums} />
              </>
            )}
          </TabsContent>

          <TabsContent value="exif">
            <ExifPanel entries={metadata} />
          </TabsContent>
        </Tabs>
      </aside>
    </div>
  );
}

function NavArrow({
  side,
  href,
  label,
  replace = false,
}: {
  side: "left" | "right";
  href: string;
  label: string;
  replace?: boolean;
}) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  // The absolute centering (-translate-y-1/2) lives on this wrapper, not the
  // Button: the shadcn Button toggles `translate-y-px` on :active, which writes
  // the same transform and would otherwise wipe out the vertical centering on
  // click. Keeping them on separate elements lets the press-nudge coexist.
  return (
    <div
      className={cn(
        "absolute top-1/2 -translate-y-1/2",
        side === "left" ? "left-2" : "right-2",
      )}
    >
      <Button asChild variant="outline" size="icon" className="backdrop-blur">
        <Link href={href} replace={replace} aria-label={label}>
          <Icon className="size-5" />
        </Link>
      </Button>
    </div>
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

function ExifPanel({ entries }: { entries: Array<[string, string]> }) {
  const [query, setQuery] = useState("");
  const filtered = filterExifEntries(entries, query);
  return (
    <div className="space-y-3">
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search metadata"
          aria-label="Search metadata"
          className="pl-9"
        />
      </div>
      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">No metadata</p>
      ) : filtered.length === 0 ? (
        <p className="text-xs text-muted-foreground">No metadata matches &ldquo;{query}&rdquo;.</p>
      ) : (
        <dl className="space-y-1 text-xs">
          {filtered.map(([key, value]) => (
            <div key={key} className="flex justify-between gap-3">
              <dt className="shrink-0 text-muted-foreground">{key}</dt>
              <dd className="min-w-0 break-all text-right font-mono">{value}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate text-right">{value}</span>
    </div>
  );
}
