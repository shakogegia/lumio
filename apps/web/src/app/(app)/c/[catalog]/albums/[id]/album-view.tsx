"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download, FolderMinus, ImageUp, Images, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useConfirm } from "@/components/confirm-dialog";
import { countLabel } from "@/lib/count-label";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { PhotoLibraryView } from "@/components/photo-library/photo-library-view";
import { photoHref } from "@/lib/photo-href";
import { catalogApiUrl, catalogPath } from "@/lib/catalog-api";
import { useCatalog } from "@/components/providers/catalog-context";

export function AlbumView({
  albumId,
  albumName,
  isSmart,
  coverPhotoId,
}: {
  albumId: string;
  albumName: string;
  isSmart: boolean;
  coverPhotoId: string | null;
}) {
  const router = useRouter();
  const { slug } = useCatalog();
  const { confirm, confirmDialog } = useConfirm();
  const [reloadKey, setReloadKey] = useState(0);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);

  return (
    <>
      {confirmDialog}
      <PhotoLibraryView
        title={albumName}
        collection={({ sort, month, field }) => ({
          endpoint: catalogApiUrl(slug, `/albums/${albumId}/photos`),
          params: new URLSearchParams(month ? { sort, month, dateField: field } : { sort }),
          urlForId: (id) => photoHref(slug, id, albumId, sort),
          baseUrl: catalogPath(slug, `/albums/${albumId}`),
          key: `${albumId}:${sort}:${month ?? ""}${month ? `:${field}` : ""}:${reloadKey}`,
        })}
        calendar={{ facetsEndpoint: catalogApiUrl(slug, `/albums/${albumId}/calendar`) }}
        actionOptions={{
          excludeAlbumId: albumId,
          albumCover: isSmart ? undefined : { albumId, coverPhotoId },
          onTrashed: () => router.refresh(),
        }}
        empty={
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Images />
              </EmptyMedia>
              <EmptyTitle>This album is empty</EmptyTitle>
              <EmptyDescription>
                Photos you add to this album will appear here.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        }
        headerActions={
          <>
            {!isSmart && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    asChild
                    variant="outline"
                    size="icon-sm"
                    aria-label="Upload to this album"
                  >
                    <a href={catalogPath(slug, `/upload?albumId=${albumId}`)}>
                      <Upload aria-hidden />
                    </a>
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Upload to this album</TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  asChild
                  variant="outline"
                  size="icon-sm"
                  aria-label="Download album"
                >
                  <a href={catalogApiUrl(slug, `/albums/${albumId}/download`)}>
                    <Download aria-hidden />
                  </a>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Download album</TooltipContent>
            </Tooltip>
          </>
        }
        selectionActions={({ actions, selectedIds, clearSelection }) => {
          async function handleRemove() {
            const ids = [...selectedIds];
            if (ids.length === 0 || removing) return;
            const label = countLabel(ids.length, "photo", "photos");
            const ok = await confirm({
              title: `Remove ${label} from this album?`,
              description: "The photos stay in your library and Trash is unaffected.",
              confirmLabel: "Remove",
              destructive: true,
            });
            if (!ok) return;
            setRemoving(true);
            setRemoveError(null);
            try {
              const res = await fetch(catalogApiUrl(slug, `/albums/${albumId}/photos`), {
                method: "DELETE",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ photoIds: ids }),
              });
              if (res.ok) {
                clearSelection();
                setReloadKey((k) => k + 1);
                router.refresh();
              } else {
                setRemoveError("Failed to remove photos from this album.");
              }
            } catch {
              setRemoveError("Failed to remove photos from this album.");
            } finally {
              setRemoving(false);
            }
          }

          return (
            <>
              {!isSmart && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="outline"
                      size="icon-sm"
                      disabled={selectedIds.size !== 1}
                      onClick={() => void actions.setAlbumCover([...selectedIds][0])}
                      aria-label="Set as album cover"
                    >
                      <ImageUp aria-hidden />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Set as album cover</TooltipContent>
                </Tooltip>
              )}
              {!isSmart && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="destructive"
                      size="icon-sm"
                      disabled={selectedIds.size === 0 || removing}
                      onClick={() => void handleRemove()}
                      aria-label="Remove from album"
                    >
                      {removing ? (
                        <Loader2 className="animate-spin" aria-hidden />
                      ) : (
                        <FolderMinus aria-hidden />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Remove from album</TooltipContent>
                </Tooltip>
              )}
            </>
          );
        }}
        aboveGrid={removeError ? <p className="mb-4 text-sm text-destructive">{removeError}</p> : null}
      />
    </>
  );
}
