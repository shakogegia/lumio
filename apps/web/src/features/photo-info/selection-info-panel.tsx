"use client";

import { usePhotoCollection } from "@/features/photo-grid";
import { Skeleton } from "@/components/ui/skeleton";
import { PhotoInfoPanel } from "./photo-info-panel";
import { SelectionMetadataForm } from "./selection-metadata-form";

/**
 * The inspector body. Switches on selection size:
 *  - 0  → a muted empty hint (the panel persists, it doesn't yank shut).
 *  - 1  → the full single-photo Info tab (identical to the lightbox).
 *  - 2+ → the live, Mixed-aware bulk metadata editor (writes to all selected).
 * `getPhotos` is reactive on the grid store, so the single-photo view fills in
 * as soon as the selected tile is loaded.
 */
export function SelectionInfoPanel({ selectedIds }: { selectedIds: Set<string> }) {
  const { getPhotos } = usePhotoCollection();
  const ids = [...selectedIds];

  if (ids.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Select photos to see details
      </p>
    );
  }

  if (ids.length === 1) {
    const photo = getPhotos(new Set(ids))[0];
    if (!photo) {
      return (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-7 w-full" />
          ))}
        </div>
      );
    }
    return <PhotoInfoPanel photo={photo} />;
  }

  return <SelectionMetadataForm selectedIds={selectedIds} />;
}
