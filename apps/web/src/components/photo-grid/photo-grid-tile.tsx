"use client";

import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
import type { PhotoDTO } from "@lumio/shared";
import { photoHref } from "@/lib/photo-href";
import type { GridViewMode } from "@/lib/use-grid-view";
import { cn } from "@/lib/utils";
import { cellVariants } from "./cell-variants";
import { PhotoThumb } from "./photo-thumb";

/**
 * One grid cell. In select mode it's a toggle button with a checkbox overlay and
 * a shrink-on-select affordance; otherwise it's a Link to the photo. Both wrap
 * the same PhotoThumb.
 */
export function PhotoGridTile({
  photo,
  mode,
  albumId,
  hrefFor,
  selectMode,
  isSelected,
  index,
  onTileClick,
}: {
  photo: PhotoDTO;
  mode: GridViewMode;
  albumId?: string;
  /** Detail-route href override; defaults to the album/library scope. */
  hrefFor?: (id: string) => string;
  selectMode: boolean;
  isSelected: boolean;
  index: number;
  onTileClick: (index: number, e: React.MouseEvent) => void;
}) {
  const thumb = <PhotoThumb photo={photo} mode={mode} />;

  if (selectMode) {
    return (
      <button
        type="button"
        aria-pressed={isSelected}
        onClick={(e) => onTileClick(index, e)}
        className={cn(cellVariants({ mode, selected: isSelected }), "select-none")}
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
      href={hrefFor ? hrefFor(photo.id) : photoHref(photo.id, albumId)}
      className={cellVariants({ mode })}
    >
      {thumb}
    </Link>
  );
}
