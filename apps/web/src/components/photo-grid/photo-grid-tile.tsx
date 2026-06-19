"use client";

import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
import type { PhotoDTO } from "@lumio/shared";
import { photoHref } from "@/lib/photo-href";
import type { ThumbnailFit } from "@/lib/use-thumbnail-fit";
import { cn } from "@/lib/utils";
import { PhotoThumb } from "./photo-thumb";

/**
 * One grid cell. In select mode it's a toggle button with a checkbox overlay and
 * a shrink-on-select affordance; otherwise it's a Link to the photo. Both wrap
 * the same PhotoThumb.
 */
export function PhotoGridTile({
  photo,
  fit,
  albumId,
  selectMode,
  isSelected,
  index,
  onTileClick,
}: {
  photo: PhotoDTO;
  fit: ThumbnailFit;
  albumId?: string;
  selectMode: boolean;
  isSelected: boolean;
  index: number;
  onTileClick: (index: number, e: React.MouseEvent) => void;
}) {
  const thumb = <PhotoThumb photo={photo} fit={fit} />;

  if (selectMode) {
    return (
      <button
        type="button"
        aria-pressed={isSelected}
        onClick={(e) => onTileClick(index, e)}
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
      href={photoHref(photo.id, albumId)}
      className="block h-full outline-none focus:outline-none focus-visible:outline-none"
    >
      {thumb}
    </Link>
  );
}
