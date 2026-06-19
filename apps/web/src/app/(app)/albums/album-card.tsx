"use client";

import Link from "next/link";
import { CheckCircle2, Circle, Images } from "lucide-react";
import type { AlbumSummaryDTO } from "@lumio/shared";
import { cn } from "@/lib/utils";

/**
 * One album in the listing grid. In select mode it's a toggle button that adds
 * or removes the album from the shared selection set (no navigation), with a
 * checkbox overlay, a selected ring, and a shrink-on-select affordance —
 * mirroring PhotoGridTile. Otherwise it's a Link to the album.
 */
export function AlbumCard({
  album,
  selectMode,
  isSelected,
  onToggle,
}: {
  album: AlbumSummaryDTO;
  selectMode: boolean;
  isSelected: boolean;
  onToggle: (id: string) => void;
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

  if (selectMode) {
    return (
      <button
        type="button"
        aria-pressed={isSelected}
        onClick={() => onToggle(album.id)}
        className="group block w-full select-none text-left"
      >
        <div
          className={cn(
            "relative rounded-sm",
            isSelected && "ring-2 ring-inset ring-primary",
          )}
        >
          <div className={cn("transition-transform", isSelected && "scale-[0.96]")}>
            {cover}
          </div>
          <span className="absolute left-2 top-2 rounded-full bg-background text-foreground">
            {isSelected ? (
              <CheckCircle2 className="size-5 text-primary" />
            ) : (
              <Circle className="size-5 text-muted-foreground" />
            )}
          </span>
        </div>
        {meta}
      </button>
    );
  }

  return (
    <Link href={`/albums/${album.id}`} className="group block">
      {cover}
      {meta}
    </Link>
  );
}
