"use client";

import Link from "next/link";
import { CheckCircle2, Circle } from "lucide-react";
import { colorLabelHex, type PhotoDTO, type PhotoSort } from "@lumio/shared";
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
  sort,
  hrefFor,
  selectMode,
  isSelected,
  index,
  onTileClick,
}: {
  photo: PhotoDTO;
  mode: GridViewMode;
  albumId?: string;
  sort?: PhotoSort;
  /** Detail-route href override; defaults to the album/library scope. */
  hrefFor?: (id: string) => string;
  selectMode: boolean;
  isSelected: boolean;
  index: number;
  onTileClick: (index: number, e: React.MouseEvent) => void;
}) {
  const thumb = <PhotoThumb photo={photo} mode={mode} />;

  // In card mode a labeled photo tints its mat. The hex is exposed as a CSS
  // variable and the `.label-mat` class (in globals.css) decides how to render it
  // per theme — light uses it as-is, dark blends it toward the mat surface so the
  // pastels don't glow against the near-black background.
  const labelHex = mode === "card" ? colorLabelHex(photo.colorLabel) : undefined;
  const labelStyle = labelHex
    ? ({ "--label-tint": labelHex } as React.CSSProperties)
    : undefined;

  if (selectMode) {
    return (
      <button
        type="button"
        aria-pressed={isSelected}
        onClick={(e) => onTileClick(index, e)}
        className={cn(
          cellVariants({ mode, selected: isSelected }),
          "select-none",
          labelHex && "label-mat",
        )}
        style={labelStyle}
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
      href={hrefFor ? hrefFor(photo.id) : photoHref(photo.id, albumId, sort)}
      className={cn(cellVariants({ mode }), labelHex && "label-mat")}
      style={labelStyle}
    >
      {thumb}
    </Link>
  );
}
