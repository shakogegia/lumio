"use client";

import { photoHref } from "@/lib/photo-href";
import { catalogApiUrl, catalogPath } from "@/lib/catalog-api";
import { useCatalog } from "@/components/providers/catalog-context";
import { useFeature } from "@/components/features/features-provider";
import { FeatureKey } from "@lumio/shared";
import { ShareButton } from "@/components/photo-actions/share-button";
import { PhotoLibraryView } from "@/components/photo-library/photo-library-view";

export function LibraryView() {
  const { slug } = useCatalog();
  const sharingEnabled = useFeature(FeatureKey.Sharing);
  return (
    <PhotoLibraryView
      title="Library"
      calendar={{ facetsEndpoint: catalogApiUrl(slug, "/photos/calendar") }}
      selectionActions={
        sharingEnabled
          ? ({ selectedIds }) => <ShareButton ids={[...selectedIds]} />
          : undefined
      }
      collection={({ sort, month }) => ({
        endpoint: catalogApiUrl(slug, "/photos"),
        params: new URLSearchParams(month ? { sort, month } : { sort }),
        urlForId: (id) => photoHref(slug, id, undefined, sort),
        baseUrl: catalogPath(slug, "/photos"),
        key: `${sort}:${month ?? ""}`,
      })}
    />
  );
}
