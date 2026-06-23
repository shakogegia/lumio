"use client";

import { colorLabelHex, type PhotoDTO, type PhotoSort } from "@lumio/shared";
import { photoHref } from "@/lib/photo-href";
import { useCatalog } from "@/lib/catalog-context";
import type { GridViewMode } from "@/lib/use-grid-view";
import { cn } from "@/lib/utils";
import { resolveTargets } from "@/lib/resolve-targets";
import { cellVariants } from "./cell-variants";
import { FavoriteHeart } from "./favorite-heart";
import { PhotoContextMenu } from "./photo-context-menu";
import { PhotoThumb } from "./photo-thumb";
import { SelectionRing } from "./selection-ring";
import { usePhotoActionsContext } from "@/components/photo-actions/photo-actions-context";

/**
 * One grid cell. Selection is always available: a plain left click selects only
 * this tile, ⌘ (Mac) / Ctrl (Windows) click toggles it into a multi-selection,
 * and shift-click extends a range. A double click opens the detail; middle click
 * falls through to the native link, so the photo opens in a new tab. When the
 * collection has no detail view (e.g. Trash, where `onOpen` is absent) there is
 * no href and double click is a no-op — the tile is select-only.
 *
 * The tile is wrapped in a right-click PhotoContextMenu, which renders the tile
 * unwrapped when no actions provider is present (e.g. the Trash grid).
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
  selectedIds,
  onTrash,
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
  /** Current selection, for selection-aware context-menu targeting. */
  selectedIds?: Set<string>;
  /** Drop these ids from the selection after a menu-driven trash. */
  onTrash?: (ids: string[]) => void;
}) {
  const { slug } = useCatalog();
  const thumb = <PhotoThumb photo={photo} mode={mode} />;
  const actions = usePhotoActionsContext();

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
      : photoHref(slug, photo.id, albumId, sort)
    : undefined;

  const targetIds = resolveTargets(selectedIds, photo.id);

  return (
    <PhotoContextMenu
      targetIds={targetIds}
      onTrashed={onTrash ? () => onTrash(targetIds) : undefined}
    >
      <a
        href={href}
        onClick={(e) => {
          // Middle/aux click on a real link opens the detail in a new tab; every
          // left click drives selection: plain = select only this, ⌘/Ctrl =
          // toggle into a multi-selection, shift = extend the range.
          if (href && e.button !== 0) return;
          e.preventDefault();
          onTileClick(index, e);
        }}
        onDoubleClick={(e) => {
          if (!onOpen) return;
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          onOpen(index);
        }}
        className={cn(cellVariants({ mode }), "group/cell select-none", labelHex && "label-mat")}
        style={labelStyle}
      >
        {thumb}
        {actions && (
          <FavoriteHeart
            active={photo.isFavorite}
            onToggle={() => void actions.favorite([photo.id], !photo.isFavorite)}
          />
        )}
        {isSelected && <SelectionRing />}
      </a>
    </PhotoContextMenu>
  );
}
