"use client";

import { CheckCircle2, Circle } from "lucide-react";
import { colorLabelHex, type PhotoDTO, type PhotoSort } from "@lumio/shared";
import { photoHref } from "@/lib/photo-href";
import type { GridViewMode } from "@/lib/use-grid-view";
import { cn } from "@/lib/utils";
import { resolveTargets } from "@/lib/resolve-targets";
import { cellVariants } from "./cell-variants";
import { PhotoContextMenu } from "./photo-context-menu";
import { PhotoThumb } from "./photo-thumb";

/**
 * One grid cell. In select mode it's a toggle button with a checkbox overlay and
 * a shrink-on-select affordance; otherwise it's a Link to the photo. Both wrap
 * the same PhotoThumb, and both are wrapped in a right-click PhotoContextMenu.
 */
export function PhotoGridTile({
  photo,
  mode,
  albumId,
  sort,
  onOpen,
  urlForId,
  selectMode,
  isSelected,
  index,
  onTileClick,
  selectedIds,
  onTrash,
}: {
  photo: PhotoDTO;
  mode: GridViewMode;
  albumId?: string;
  sort?: PhotoSort;
  onOpen?: (index: number) => void;
  urlForId?: (id: string) => string;
  selectMode: boolean;
  isSelected: boolean;
  index: number;
  onTileClick: (index: number, e: React.MouseEvent) => void;
  /** Current selection, for selection-aware context-menu targeting. */
  selectedIds?: Set<string>;
  /** Drop these ids from the selection after a menu-driven trash. */
  onTrash?: (ids: string[]) => void;
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

  const targetIds = resolveTargets(selectedIds, photo.id);

  const tile = selectMode ? (
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
  ) : (
    <a
      href={urlForId ? urlForId(photo.id) : photoHref(photo.id, albumId, sort)}
      onClick={(e) => {
        if (!onOpen) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        onOpen(index);
      }}
      className={cn(cellVariants({ mode }), labelHex && "label-mat")}
      style={labelStyle}
    >
      {thumb}
    </a>
  );

  return (
    <PhotoContextMenu
      targetIds={targetIds}
      onTrashed={onTrash ? () => onTrash(targetIds) : undefined}
    >
      {tile}
    </PhotoContextMenu>
  );
}
