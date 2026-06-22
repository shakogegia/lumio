"use client";

import { catalogApiUrl, catalogPath } from "@/lib/catalog-api";
import { useCatalog } from "@/lib/catalog-context";
import { detailScopeQuery } from "@/lib/detail-scope";
import { PhotoLibraryView } from "@/components/photo-library/photo-library-view";
import type { FolderSummary } from "@/lib/catalog-fs-service";
import { FolderBreadcrumb } from "./folder-breadcrumb";
import { FoldersSection } from "./folders-section";

export function FolderExplorer({ rel, subfolders }: { rel: string; subfolders: FolderSummary[] }) {
  const { slug } = useCatalog();
  return (
    <PhotoLibraryView
      title={<FolderBreadcrumb slug={slug} rel={rel} />}
      aboveGrid={<FoldersSection slug={slug} folders={subfolders} />}
      calendar={{ facetsEndpoint: catalogApiUrl(slug, `/fs/calendar?path=${encodeURIComponent(rel)}`) }}
      collection={({ sort, month }) => {
        const q = detailScopeQuery({ kind: "folder", dir: rel, sort });
        return {
          endpoint: catalogApiUrl(slug, "/fs/photos"),
          params: new URLSearchParams(
            month ? { path: rel, sort, month } : { path: rel, sort },
          ),
          urlForId: (id) =>
            catalogPath(slug, q ? `/photo/${id}?${q}` : `/photo/${id}`),
          baseUrl: rel
            ? `${catalogPath(slug, "/folders")}?path=${encodeURIComponent(rel)}`
            : catalogPath(slug, "/folders"),
          key: `folder:${rel}:${sort}:${month ?? ""}`,
        };
      }}
    />
  );
}
