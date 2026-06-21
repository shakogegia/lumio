"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ColorLabel, DownloadVariant } from "@lumio/shared";
import { downloadSelection } from "@/lib/download-client";
import { useConfirm } from "@/components/confirm-dialog";
import { AddToAlbumDialog } from "@/components/photo-actions/add-to-album-dialog";
import type { PhotoGridHandle } from "@/components/photo-grid/photo-grid";
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
  const { confirm, confirmDialog } = useConfirm();
  const [downloading, setDownloading] = useState(false);
  const [labelPending, setLabelPending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [favoritePending, setFavoritePending] = useState(false);
  // Open the add-to-album dialog for a captured id set; `onSuccess` runs on add.
  const [albumTarget, setAlbumTarget] = useState<{ ids: string[]; onSuccess?: () => void } | null>(null);

  const download = useCallback(
    async (ids: string[], opts?: ActionOpts) => {
      if (ids.length === 0 || downloading) return;
      setDownloading(true);
      try {
        await downloadSelection(ids, opts?.variant);
        opts?.onSuccess?.();
      } catch {
        toast.error("Failed to download photos.");
      } finally {
        setDownloading(false);
      }
    },
    [downloading],
  );

  const applyLabel = useCallback(
    async (ids: string[], label: ColorLabel | null, opts?: ActionOpts) => {
      if (ids.length === 0 || labelPending) return;
      setLabelPending(true);
      try {
        const res = await fetch("/api/photos/color-label", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ photoIds: ids, label }),
        });
        if (!res.ok) throw new Error("label failed");
        gridRef.current?.patchPhotos(new Set(ids), { colorLabel: label });
        opts?.onSuccess?.();
      } catch {
        toast.error("Failed to apply label.");
      } finally {
        setLabelPending(false);
      }
    },
    [labelPending, gridRef],
  );

  const favorite = useCallback(
    async (ids: string[], isFavorite: boolean, opts?: ActionOpts) => {
      if (ids.length === 0 || favoritePending) return;
      setFavoritePending(true);
      try {
        const res = await fetch("/api/photos/favorite", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ photoIds: ids, isFavorite }),
        });
        if (!res.ok) throw new Error("favorite failed");
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
    [favoritePending, gridRef, dropOnUnfavorite],
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
        const res = await fetch("/api/photos/trash", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ids }),
        });
        if (!res.ok) throw new Error("trash failed");
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
    [deleting, confirm, trashDescription, gridRef, onTrashed],
  );

  const addToAlbum = useCallback((ids: string[], opts?: ActionOpts) => {
    if (ids.length === 0) return;
    setAlbumTarget({ ids, onSuccess: opts?.onSuccess });
  }, []);

  const addToAlbumDirect = useCallback(
    async (ids: string[], albumId: string, opts?: ActionOpts) => {
      if (ids.length === 0) return;
      try {
        const res = await fetch(`/api/albums/${albumId}/photos`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ photoIds: ids }),
        });
        if (!res.ok) throw new Error("add failed");
        // Mirror AddToAlbumDialog: refresh so album counts/covers stay current.
        router.refresh();
        playSound(SoundEffect.ActionComplete);
        opts?.onSuccess?.();
      } catch {
        toast.error("Failed to add photos to the album.");
      }
    },
    [router],
  );

  const setAlbumCover = useCallback(
    async (photoId: string, opts?: ActionOpts) => {
      if (!albumCover) return;
      try {
        const res = await fetch(`/api/albums/${albumCover.albumId}`, {
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
    [albumCover, router],
  );

  const element = (
    <>
      {confirmDialog}
      <AddToAlbumDialog
        open={albumTarget !== null}
        onOpenChange={(open) => {
          if (!open) setAlbumTarget(null);
        }}
        photoIds={albumTarget?.ids ?? []}
        onAdded={() => {
          albumTarget?.onSuccess?.();
          setAlbumTarget(null);
        }}
      />
    </>
  );

  return {
    download,
    applyLabel,
    trash,
    favorite,
    addToAlbum,
    addToAlbumDirect,
    setAlbumCover,
    excludeAlbumId,
    albumCover,
    pending: { download: downloading, label: labelPending, trash: deleting, favorite: favoritePending },
    element,
  };
}
