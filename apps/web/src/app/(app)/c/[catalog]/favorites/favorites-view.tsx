"use client";

import { Heart } from "lucide-react";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { photoHref } from "@/lib/photo-href";
import { catalogApiUrl, catalogPath } from "@/lib/catalog-api";
import { useCatalog } from "@/components/providers/catalog-context";
import { PhotoLibraryView } from "@/components/photo-library/photo-library-view";

const FAVORITES_EMPTY = (
  <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <Heart />
      </EmptyMedia>
      <EmptyTitle>No favorites yet</EmptyTitle>
      <EmptyDescription>
        Tap the heart on a photo to add it to your favorites.
      </EmptyDescription>
    </EmptyHeader>
  </Empty>
);

export function FavoritesView() {
  const { slug } = useCatalog();
  return (
    <PhotoLibraryView
      title="Favorites"
      empty={FAVORITES_EMPTY}
      actionOptions={{ dropOnUnfavorite: true }}
      calendar={{ facetsEndpoint: catalogApiUrl(slug, "/photos/calendar?favorite=true") }}
      collection={({ sort, month, field }) => ({
        endpoint: catalogApiUrl(slug, "/photos"),
        params: new URLSearchParams(
          month ? { sort, favorite: "true", month, dateField: field } : { sort, favorite: "true" },
        ),
        urlForId: (id) => photoHref(slug, id, undefined, sort),
        baseUrl: catalogPath(slug, "/favorites"),
        key: `fav:${sort}:${month ?? ""}${month ? `:${field}` : ""}`,
      })}
    />
  );
}
