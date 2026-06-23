"use client";

import { useRouter } from "next/navigation";
import { Images } from "lucide-react";
import { photoHref } from "@/lib/photo-href";
import { catalogApiUrl, catalogPath } from "@/lib/catalog-api";
import { useCatalog } from "@/lib/catalog-context";
import { PhotoLibraryView } from "@/components/photo-library/photo-library-view";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

export function FolderPhotosView({ folderId, folderName }: { folderId: string; folderName: string }) {
  const router = useRouter();
  const { slug } = useCatalog();
  return (
    <PhotoLibraryView
      title={folderName}
      actionOptions={{ onTrashed: () => router.refresh() }}
      collection={({ sort }) => ({
        endpoint: catalogApiUrl(slug, `/folders/${folderId}/photos`),
        params: new URLSearchParams({ sort }),
        urlForId: (id) => photoHref(slug, id, undefined, sort),
        baseUrl: catalogPath(slug, `/albums/folder/${folderId}/photos`),
        key: sort,
      })}
      empty={
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Images />
            </EmptyMedia>
            <EmptyTitle>No photos here yet</EmptyTitle>
            <EmptyDescription>Photos from albums in this folder will appear here.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      }
    />
  );
}
