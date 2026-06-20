"use client";

import { Images } from "lucide-react";
import type { AlbumSummaryDTO } from "@lumio/shared";
import { cn } from "@/lib/utils";

/**
 * One album in the listing grid. Selection is always available: a plain left
 * click toggles the album in the shared selection set (blue ring, no
 * navigation); a double click opens it. ⌘/Ctrl/middle click falls through to the
 * native link, so the album opens in a new tab.
 */
export function AlbumCard({
  album,
  isSelected,
  onToggle,
  onOpen,
}: {
  album: AlbumSummaryDTO;
  isSelected: boolean;
  onToggle: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const cover = (
    <div className="relative flex aspect-[4/3] items-center justify-center overflow-hidden rounded-sm bg-muted">
      {album.coverPhotoId ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/thumbnails/${album.coverPhotoId}`}
          alt={album.name}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
        />
      ) : (
        <Images className="size-8 text-muted-foreground" />
      )}
    </div>
  );

  const meta = (
    <div className="mt-2.5">
      <p className="truncate text-sm font-semibold">{album.name}</p>
      <p className="text-xs text-muted-foreground">
        {album.photoCount} {album.photoCount === 1 ? "photo" : "photos"}
      </p>
    </div>
  );

  return (
    <a
      href={`/albums/${album.id}`}
      onClick={(e) => {
        // ⌘/Ctrl/middle click opens the album in a new tab; a plain click toggles.
        if (e.metaKey || e.ctrlKey || e.button !== 0) return;
        e.preventDefault();
        onToggle(album.id);
      }}
      onDoubleClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        onOpen(album.id);
      }}
      className="group block select-none"
    >
      <div
        className={cn(
          "relative rounded-sm",
          isSelected && "ring-2 ring-offset-2 ring-offset-background ring-blue-500",
        )}
      >
        {cover}
      </div>
      {meta}
    </a>
  );
}
