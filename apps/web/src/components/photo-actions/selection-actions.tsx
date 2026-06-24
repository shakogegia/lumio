"use client";

import { Loader2, Trash2 } from "lucide-react";
import { computeFavoriteTarget } from "@lumio/shared";
import { Button } from "@/components/ui/button";
import { FavoriteButton } from "@/components/photo-actions/favorite-button";
import { ColorLabelMenu } from "@/components/photo-actions/color-label-menu";
import { AddToAlbumMenu } from "@/components/photo-actions/add-to-album-menu";
import { DownloadMenu } from "@/components/photo-actions/download-menu";
import type { PhotoActions } from "@/components/photo-actions/use-photo-actions";
import type { PhotoGridHandle } from "@/features/photo-grid";

/**
 * The standard bulk-action button set shared by every photo library view:
 * favorite, color label, add-to-album, download, trash. Wired to usePhotoActions
 * + the selection. Download and trash clear the selection on success (the
 * terminal actions); favorite/label/add keep it so you can chain edits — except
 * in a favorites view (`clearOnFavorite`), where unfavoriting drops the tiles so
 * the selection must clear too.
 */
export function SelectionActions({
  actions,
  selectedIds,
  gridRef,
  clearSelection,
  clearOnFavorite = false,
  anyEdited = false,
}: {
  actions: PhotoActions;
  selectedIds: Set<string>;
  gridRef: React.RefObject<PhotoGridHandle | null>;
  clearSelection: () => void;
  /** Favorites view: (un)favorite drops tiles, so clear the selection after. */
  clearOnFavorite?: boolean;
  /** Any selected photo has edits → Download offers edited vs original. The
   *  parent computes this from inside the provider (SelectionEditReporter),
   *  since this toolbar renders outside it and can't read the grid directly. */
  anyEdited?: boolean;
}) {
  const ids = [...selectedIds];
  const none = ids.length === 0;
  return (
    <>
      <FavoriteButton
        disabled={none || actions.pending.favorite}
        pending={actions.pending.favorite}
        onClick={() => {
          const target = computeFavoriteTarget(gridRef.current?.getPhotos(selectedIds) ?? []);
          void actions.favorite(ids, target, clearOnFavorite ? { onSuccess: clearSelection } : undefined);
        }}
      />
      <ColorLabelMenu
        disabled={none || actions.pending.label}
        onPick={(label) => void actions.applyLabel(ids, label)}
      />
      <AddToAlbumMenu
        disabled={none}
        excludeAlbumId={actions.excludeAlbumId}
        onPick={(albumId) => void actions.addToAlbumDirect(ids, albumId)}
        onCreateNew={() => actions.addToAlbum(ids)}
      />
      <DownloadMenu
        count={ids.length}
        anyEdited={anyEdited}
        disabled={none || actions.pending.download}
        pending={actions.pending.download}
        onDownload={(variant) => void actions.download(ids, { variant, onSuccess: clearSelection })}
      />
      <Button
        variant="destructive"
        size="icon-sm"
        disabled={none || actions.pending.trash}
        onClick={() => void actions.trash(ids, { onSuccess: clearSelection })}
        aria-label="Delete"
        title="Delete"
      >
        {actions.pending.trash ? <Loader2 className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
      </Button>
    </>
  );
}
