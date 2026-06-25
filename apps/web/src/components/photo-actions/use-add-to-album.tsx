"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { invalidateLibraryTree } from "@/components/library-tree/library-tree";
import { AddToAlbumDialog } from "@/components/photo-actions/add-to-album-dialog";
import { useCatalog } from "@/components/providers/catalog-context";
import { addPhotosToAlbum } from "@/lib/photo-mutations";
import { playSound } from "@/lib/sound/player";
import { SoundEffect } from "@/lib/sound/registry";

/** Per-call hook into a successful add (e.g. clear/cancel the selection). */
export type AddToAlbumOpts = { onSuccess?: () => void };

export interface AddToAlbumControls {
  /** Open the "create / pick album" dialog (the "New album…" path). */
  addToAlbum: (ids: string[], opts?: AddToAlbumOpts) => void;
  /** Add straight to an existing album, no dialog (the nested-menu path). */
  addToAlbumDirect: (ids: string[], albumId: string, opts?: AddToAlbumOpts) => Promise<void>;
  /** The add-to-album dialog. Render once per view. */
  element: React.ReactNode;
}

/**
 * The grid-independent half of the add-to-album flow: the quick-pick network
 * call, the "New album…" dialog, and its state. Both `usePhotoActions` (the
 * photo-grid views) and the upload page consume this, so the fetch + dialog
 * live in exactly one place. Mirrors `useConfirm`: returns the action functions
 * plus an `element` to render.
 */
export function useAddToAlbum(): AddToAlbumControls {
  const router = useRouter();
  const { slug } = useCatalog();
  // Open the add-to-album dialog for a captured id set; `onSuccess` runs on add.
  const [albumTarget, setAlbumTarget] = useState<{ ids: string[]; onSuccess?: () => void } | null>(null);

  const addToAlbum = useCallback((ids: string[], opts?: AddToAlbumOpts) => {
    if (ids.length === 0) return;
    setAlbumTarget({ ids, onSuccess: opts?.onSuccess });
  }, []);

  const addToAlbumDirect = useCallback(
    async (ids: string[], albumId: string, opts?: AddToAlbumOpts) => {
      if (ids.length === 0) return;
      try {
        await addPhotosToAlbum(slug, albumId, ids);
        // Mirror AddToAlbumDialog: invalidate the cached library tree (so sidebar/
        // picker album covers + counts update) and refresh server components.
        invalidateLibraryTree();
        router.refresh();
        playSound(SoundEffect.ActionComplete);
        opts?.onSuccess?.();
      } catch {
        toast.error("Failed to add photos to the album.");
      }
    },
    [router, slug],
  );

  const element = (
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
  );

  return { addToAlbum, addToAlbumDirect, element };
}
