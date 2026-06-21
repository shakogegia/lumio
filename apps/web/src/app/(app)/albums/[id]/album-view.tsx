"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, FolderMinus, Images, ImageUp, Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGridSelection } from "@/lib/use-grid-selection";
import { useGridView } from "@/lib/use-grid-view";
import { useGridColumns } from "@/lib/use-grid-columns";
import { GridViewMenu } from "@/components/grid-view-menu";
import { GridSizeMenu } from "@/components/grid-size-menu";
import { useGridSort } from "@/lib/use-grid-sort";
import { GridSortMenu } from "@/components/grid-sort-menu";
import { GridCalendarMenu } from "@/components/grid-calendar-menu";
import { PhotoGrid, type PhotoGridHandle } from "@/components/photo-grid/photo-grid";
import { PhotoCollectionProvider } from "@/components/photo-grid/photo-collection";
import { CollectionTotalReporter } from "@/components/photo-grid/collection-total-reporter";
import { Lightbox } from "@/components/photo-grid/lightbox";
import { countLabel } from "@/lib/count-label";
import { Skeleton } from "@/components/ui/skeleton";
import { photoHref } from "@/lib/photo-href";
import { SelectionToolbar } from "@/app/(app)/photos/selection-toolbar";
import { HeaderBar } from "@/components/header-bar";
import { useConfirm } from "@/components/confirm-dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { usePhotoActions } from "@/components/photo-actions/use-photo-actions";
import { PhotoActionsProvider } from "@/components/photo-actions/photo-actions-context";
import { AddToAlbumMenu } from "@/components/photo-actions/add-to-album-menu";
import { computeFavoriteTarget } from "@lumio/shared";
import { FavoriteButton } from "@/components/photo-actions/favorite-button";

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
  const sel = useGridSelection();
  const { mode, setMode } = useGridView();
  const { columns, setColumns } = useGridColumns();
  const { sort, setSort } = useGridSort();
  const [month, setMonth] = useState<string | null>(null);
  const { confirm, confirmDialog } = useConfirm();
  const [reloadKey, setReloadKey] = useState(0);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const totalLabel = total !== null ? countLabel(total, "photo", "photos") : undefined;
  // Show a skeleton in the subtitle slot while the count loads (keeps the line reserved).
  const countSubtitle = totalLabel ?? <Skeleton className="inline-block h-3 w-16 align-middle" />;
  const gridRef = useRef<PhotoGridHandle>(null);
  const actions = usePhotoActions({
    gridRef,
    excludeAlbumId: albumId,
    albumCover: isSmart ? undefined : { albumId, coverPhotoId },
    trashDescription: "This removes them from your whole library. You can restore them from Trash.",
    // Trash is a whole-library op; refresh so server-derived album data
    // (counts, smart-album membership) stays current.
    onTrashed: () => router.refresh(),
  });

  function handleCancel() {
    setRemoveError(null);
    sel.clear();
  }

  async function handleRemove() {
    const ids = [...sel.selected];
    if (ids.length === 0 || removing) return;
    const label = `${ids.length} ${ids.length === 1 ? "photo" : "photos"}`;
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
      const res = await fetch(`/api/albums/${albumId}/photos`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ photoIds: ids }),
      });
      if (res.ok) {
        sel.clear();
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
      {confirmDialog}
      {actions.element}
      {sel.count > 0 ? (
        <SelectionToolbar
          title={albumName}
          count={sel.count}
          totalLabel={totalLabel}
          onCancel={handleCancel}
          actions={
            <>
              <FavoriteButton
                disabled={sel.count === 0 || actions.pending.favorite}
                pending={actions.pending.favorite}
                onClick={() => {
                  const target = computeFavoriteTarget(gridRef.current?.getPhotos(sel.selected) ?? []);
                  void actions.favorite([...sel.selected], target);
                }}
              />
              <AddToAlbumMenu
                disabled={sel.count === 0}
                excludeAlbumId={actions.excludeAlbumId}
                onPick={(targetId) => void actions.addToAlbumDirect([...sel.selected], targetId)}
                onCreateNew={() => actions.addToAlbum([...sel.selected])}
              />
              {!isSmart && (
                <Button
                  variant="outline"
                  size="icon-sm"
                  disabled={sel.count !== 1}
                  onClick={() => void actions.setAlbumCover([...sel.selected][0])}
                  aria-label="Set as album cover"
                  title="Set as album cover"
                >
                  <ImageUp aria-hidden />
                </Button>
              )}
              {!isSmart && (
                <Button
                  variant="destructive"
                  size="icon-sm"
                  disabled={sel.count === 0 || removing}
                  onClick={() => void handleRemove()}
                  aria-label="Remove from album"
                  title="Remove from album"
                >
                  {removing ? <Loader2 className="animate-spin" aria-hidden /> : <FolderMinus aria-hidden />}
                </Button>
              )}
              <Button
                variant="outline"
                size="icon-sm"
                disabled={sel.count === 0 || actions.pending.download}
                onClick={() => void actions.download([...sel.selected], { onSuccess: sel.clear })}
                aria-label="Download"
                title="Download"
              >
                {actions.pending.download ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}
              </Button>
              <Button
                variant="destructive"
                size="icon-sm"
                disabled={sel.count === 0 || actions.pending.trash}
                onClick={() => void actions.trash([...sel.selected], { onSuccess: sel.clear })}
                aria-label="Delete"
                title="Delete"
              >
                {actions.pending.trash ? <Loader2 className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
              </Button>
            </>
          }
        />
      ) : (
        <HeaderBar
          title={albumName}
          subtitle={countSubtitle}
          actions={
            <>
              <GridViewMenu mode={mode} onModeChange={setMode} />
              <GridSizeMenu columns={columns} onColumnsChange={setColumns} />
              <GridSortMenu sort={sort} onSortChange={setSort} />
              <GridCalendarMenu
                facetsEndpoint={`/api/albums/${albumId}/calendar`}
                value={month}
                onChange={setMonth}
              />
              <Button asChild variant="outline" size="icon-sm" aria-label="Download album" title="Download album">
                <a href={`/api/albums/${albumId}/download`}>
                  <Download aria-hidden />
                </a>
              </Button>
            </>
          }
        />
      )}

      {removeError && (
        <p className="mb-4 text-sm text-destructive">{removeError}</p>
      )}

      <PhotoCollectionProvider
        key={`${reloadKey}:${sort}:${month ?? ""}`}
        endpoint={`/api/albums/${albumId}/photos`}
        params={new URLSearchParams(month ? { sort, month } : { sort })}
        urlForId={(id) => photoHref(id, albumId, sort)}
        baseUrl={`/albums/${albumId}`}
      >
        <CollectionTotalReporter onTotal={setTotal} />
        <PhotoActionsProvider value={actions}>
          <PhotoGrid
            apiRef={gridRef}
            mode={mode}
            columns={columns}
            selectedIds={sel.selected}
            onSelectionChange={sel.setSelected}
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
          />
          <Lightbox />
        </PhotoActionsProvider>
      </PhotoCollectionProvider>
    </>
  );
}
