"use client";

import { colorLabelHex, type PhotoDTO, type PhotoSort } from "@lumio/shared";
import { photoHref } from "@/lib/photo-href";
import type { GridViewMode } from "@/lib/use-grid-view";
import { cn } from "@/lib/utils";
import { cellVariants } from "./cell-variants";
import { PhotoThumb } from "./photo-thumb";

/**
 * One grid cell. Selection is always available: a plain left click toggles the
 * tile (shift-click extends a range); a double click opens the detail. ⌘/Ctrl/
 * middle click falls through to the native link, so the photo opens in a new tab.
 * When the collection has no detail view (e.g. Trash, where `onOpen` is absent)
 * there is no href and double click is a no-op — the tile is select-only.
 */
export function PhotoGridTile({
  photo,
  mode,
  albumId,
  sort,
  onOpen,
  urlForId,
  isSelected,
  index,
  onTileClick,
}: {
  photo: PhotoDTO;
  mode: GridViewMode;
  albumId?: string;
  sort?: PhotoSort;
  onOpen?: (index: number) => void;
  urlForId?: (id: string) => string;
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

  // No href when the detail view is disabled (Trash): the tile is select-only.
  const href = onOpen
    ? urlForId
      ? urlForId(photo.id)
      : photoHref(photo.id, albumId, sort)
    : undefined;

  return (
    <a
      href={href}
      onClick={(e) => {
        // ⌘/Ctrl/middle click on a real link opens the detail in a new tab;
        // every other click selects (plain = toggle, shift = range).
        if (href && (e.metaKey || e.ctrlKey || e.button !== 0)) return;
        e.preventDefault();
        onTileClick(index, e);
      }}
      onDoubleClick={(e) => {
        if (!onOpen) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        onOpen(index);
      }}
      className={cn(
        cellVariants({ mode, selected: isSelected }),
        "select-none",
        labelHex && "label-mat",
      )}
      style={labelStyle}
    >
      {thumb}
    </a>
  );
}
