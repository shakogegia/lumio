"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import type { PhotoDTO } from "@lumio/shared";
import { usePhotoCollection } from "./photo-collection";

/**
 * Toggle the photo's favorite state, patching the shared store on success so the
 * grid tile and lightbox stay in sync. Shared by the header button and the `f`
 * keyboard shortcut so the two can't drift.
 */
export function useToggleFavorite(photo: PhotoDTO): () => Promise<void> {
  const { patchPhotos } = usePhotoCollection();
  return useCallback(async () => {
    const next = !photo.isFavorite;
    const res = await fetch("/api/photos/favorite", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ photoIds: [photo.id], isFavorite: next }),
    });
    if (!res.ok) {
      toast.error("Failed to update favorites.");
      return;
    }
    patchPhotos(new Set([photo.id]), { isFavorite: next });
  }, [photo.id, photo.isFavorite, patchPhotos]);
}
