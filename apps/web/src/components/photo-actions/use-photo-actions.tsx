"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ColorLabel, DownloadVariant } from "@lumio/shared";
import { downloadSelection } from "@/lib/download-client";
import { catalogApiUrl } from "@/lib/catalog-api";
import { favoritePhotos, setPhotoColorLabel, trashPhotos } from "@/lib/photo-mutations";
import { useCatalog } from "@/lib/catalog-context";
import { useConfirm } from "@/components/confirm-dialog";
import { useAddToAlbum } from "@/components/photo-actions/use-add-to-album";
import type { PhotoGridHandle } from "@/features/photo-grid";
import { playSound } from "@/lib/sound/player";
import { SoundEffect } from "@/lib/sound/registry";

/** Per-call hook into a successful action (e.g. clear/cancel the selection). */
export type ActionOpts = { onSuccess?: () => void; variant?: DownloadVariant };

export interface PhotoActions {
  download: (ids: string[], opts?: ActionOpts) => Promise<void>;
  applyLabel: (ids: string[], label: ColorLabel | null, opts?: ActionOpts) => Promise<void>;
  trash: (ids: string[], opts?: ActionOpts) => Promise<void>;
  /** Set the favorite flag on the given photos (optimistic). */
  favorite: (ids: string[], isFavorite: boolean, opts?: ActionOpts) => Promise<void>;
  /** Open the "create / pick album" dialog (the "New album…" path). */
  addToAlbum: (ids: string[], opts?: ActionOpts) => void;
  /** Add straight to an existing album, no dialog (the nested-menu path). */
  addToAlbumDirect: (ids: string[], albumId: string, opts?: ActionOpts) => Promise<void>;
  /** The album currently being viewed, so album pickers can exclude it. */
  excludeAlbumId?: string;
  /** Present only in a regular-album view: the album to set covers on, plus its
   *  current pinned cover (for the "current cover" menu hint). Absent elsewhere. */
  albumCover?: { albumId: string; coverPhotoId: string | null };
  /** Pin a single photo as the current album's cover. No-op without `albumCover`. */
  setAlbumCover: (photoId: string, opts?: ActionOpts) => Promise<void>;
  pending: { download: boolean; label: boolean; trash: boolean; favorite: boolean };
  /** Dialogs (add-to-album + trash confirm). Render once per view. */
  element: React.ReactNode;
}

const DEFAULT_TRASH_DESCRIPTION = "They'll be moved to Trash. You can restore them later.";

/**
 * The four photo operations (download, color label, add-to-album, trash) over an
 * explicit id array. Owns the network call + optimistic grid update + error
 * toast + in-flight guard — the part that is identical across the photo views.
 * Each caller supplies its own aftermath via `opts.onSuccess` (e.g. the toolbar
 * clears the selection; the context menu leaves it alone). Mirrors `useConfirm`:
 * returns the action functions plus an `element` to render.
 */
export function usePhotoActions({
  gridRef,
  excludeAlbumId,
  albumCover,
  trashDescription = DEFAULT_TRASH_DESCRIPTION,
  onTrashed,
  dropOnUnfavorite = false,
}: {
  gridRef: React.RefObject<PhotoGridHandle | null>;
  /** Hide this album from the add-to-album list (the album being viewed). */
  excludeAlbumId?: string;
  /** Enable "set as album cover" for a regular album (see PhotoActions.albumCover). */
  albumCover?: { albumId: string; coverPhotoId: string | null };
  /** Confirm-dialog body for trash (album view phrases it differently). */
  trashDescription?: string;
  /** Fires after any successful trash, for view-level side effects (e.g. a
   *  search result count or an album `router.refresh()`). */
  onTrashed?: (ids: string[]) => void;
  /** In a favorites-only view, removing a favorite drops the tile from the grid
   *  instead of just clearing its heart. */
  dropOnUnfavorite?: boolean;
}): PhotoActions {
  const router = useRouter();
  const { slug } = useCatalog();
  const { confirm, confirmDialog } = useConfirm();
  const [downloading, setDownloading] = useState(false);
  const [labelPending, setLabelPending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [favoritePending, setFavoritePending] = useState(false);
  // Add-to-album (quick-pick + "New album…" dialog) is grid-independent, so it
  // lives in its own hook shared with the upload page.
  const album = useAddToAlbum();

  const download = useCallback(
    async (ids: string[], opts?: ActionOpts) => {
      if (ids.length === 0 || downloading) return;
      setDownloading(true);
      try {
        await downloadSelection(slug, ids, opts?.variant);
        opts?.onSuccess?.();
      } catch {
        toast.error("Failed to download photos.");
      } finally {
        setDownloading(false);
      }
    },
    [downloading, slug],
  );

  const applyLabel = useCallback(
    async (ids: string[], label: ColorLabel | null, opts?: ActionOpts) => {
      if (ids.length === 0 || labelPending) return;
      setLabelPending(true);
      try {
        await setPhotoColorLabel(slug, ids, label);
        gridRef.current?.patchPhotos(new Set(ids), { colorLabel: label });
        opts?.onSuccess?.();
      } catch {
        toast.error("Failed to apply label.");
      } finally {
        setLabelPending(false);
      }
    },
    [labelPending, gridRef, slug],
  );

  const favorite = useCallback(
    async (ids: string[], isFavorite: boolean, opts?: ActionOpts) => {
      if (ids.length === 0 || favoritePending) return;
      setFavoritePending(true);
      try {
        await favoritePhotos(slug, ids, isFavorite);
        if (!isFavorite && dropOnUnfavorite) {
          gridRef.current?.removePhotos(new Set(ids));
        } else {
          gridRef.current?.patchPhotos(new Set(ids), { isFavorite });
        }
        opts?.onSuccess?.();
      } catch {
        toast.error("Failed to update favorites.");
      } finally {
        setFavoritePending(false);
      }
    },
    [favoritePending, gridRef, dropOnUnfavorite, slug],
  );

  const trash = useCallback(
    async (ids: string[], opts?: ActionOpts) => {
      if (ids.length === 0 || deleting) return;
      const label = `${ids.length} ${ids.length === 1 ? "photo" : "photos"}`;
      const ok = await confirm({
        title: `Move ${label} to Trash?`,
        description: trashDescription,
        confirmLabel: "Move to Trash",
        destructive: true,
      });
      if (!ok) return;
      setDeleting(true);
      try {
        await trashPhotos(slug, ids);
        gridRef.current?.removePhotos(new Set(ids));
        playSound(SoundEffect.MoveToTrash);
        onTrashed?.(ids);
        opts?.onSuccess?.();
      } catch {
        toast.error("Failed to move photos to Trash.");
      } finally {
        setDeleting(false);
      }
    },
    [deleting, confirm, trashDescription, gridRef, onTrashed, slug],
  );

  const setAlbumCover = useCallback(
    async (photoId: string, opts?: ActionOpts) => {
      if (!albumCover) return;
      try {
        const res = await fetch(catalogApiUrl(slug, `/albums/${albumCover.albumId}`), {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ coverPhotoId: photoId }),
        });
        if (!res.ok) throw new Error("set cover failed");
        // Refresh so the card/sidebar thumbnails and the "current cover" menu
        // hint (seeded from the server) all update.
        router.refresh();
        toast.success("Album cover updated");
        opts?.onSuccess?.();
      } catch {
        toast.error("Failed to set the album cover.");
      }
    },
    [albumCover, router, slug],
  );

  const element = (
    <>
      {confirmDialog}
      {album.element}
    </>
  );

  return {
    download,
    applyLabel,
    trash,
    favorite,
    addToAlbum: album.addToAlbum,
    addToAlbumDirect: album.addToAlbumDirect,
    setAlbumCover,
    excludeAlbumId,
    albumCover,
    pending: { download: downloading, label: labelPending, trash: deleting, favorite: favoritePending },
    element,
  };
}
