"use client";

import { photoHref } from "@/lib/photo-href";
import { catalogApiUrl, catalogPath } from "@/lib/catalog-api";
import { useCatalog } from "@/components/providers/catalog-context";
import { PhotoLibraryView } from "@/components/photo-library/photo-library-view";

export function LibraryView() {
  const { slug } = useCatalog();
  return (
    <PhotoLibraryView
      title="Library"
      calendar={{ facetsEndpoint: catalogApiUrl(slug, "/photos/calendar") }}
      collection={({ sort, month, field }) => ({
        endpoint: catalogApiUrl(slug, "/photos"),
        params: new URLSearchParams(month ? { sort, month, dateField: field } : { sort }),
        urlForId: (id) => photoHref(slug, id, undefined, sort),
        baseUrl: catalogPath(slug, "/photos"),
        key: `${sort}:${month ?? ""}:${field}`,
      })}
    />
  );
}
