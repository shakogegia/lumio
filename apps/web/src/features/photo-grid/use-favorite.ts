"use client";

import { useCallback } from "react";
import { toast } from "sonner";
import type { PhotoDTO } from "@lumio/shared";
import { useCatalog } from "@/components/providers/catalog-context";
import { favoritePhotos } from "@/lib/photo-mutations";
import { usePhotoCollection } from "./photo-collection";

/**
 * Toggle the photo's favorite state, patching the shared store on success so the
 * grid tile and lightbox stay in sync. Shared by the header button and the `f`
 * keyboard shortcut so the two can't drift.
 */
export function useToggleFavorite(photo: PhotoDTO): () => Promise<void> {
  const { slug } = useCatalog();
  const { patchPhotos } = usePhotoCollection();
  return useCallback(async () => {
    const next = !photo.isFavorite;
    try {
      await favoritePhotos(slug, [photo.id], next);
      patchPhotos(new Set([photo.id]), { isFavorite: next });
    } catch {
      toast.error("Failed to update favorites.");
    }
  }, [slug, photo.id, photo.isFavorite, patchPhotos]);
}
