"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Images, Loader2, Trash2 } from "lucide-react";
import { computeFavoriteTarget } from "@lumio/shared";
import { Button } from "@/components/ui/button";
import { useGridSelection } from "@/lib/use-grid-selection";
import { useGridView } from "@/lib/use-grid-view";
import { useGridColumns } from "@/lib/use-grid-columns";
import { useGridSort } from "@/lib/use-grid-sort";
import { GridViewMenu } from "@/components/grid-view-menu";
import { GridSizeMenu } from "@/components/grid-size-menu";
import { GridSortMenu } from "@/components/grid-sort-menu";
import { PhotoGrid, type PhotoGridHandle } from "@/components/photo-grid/photo-grid";
import { PhotoCollectionProvider } from "@/components/photo-grid/photo-collection";
import { CollectionTotalReporter } from "@/components/photo-grid/collection-total-reporter";
import { Lightbox } from "@/components/photo-grid/lightbox";
import { GridShortcuts } from "@/components/photo-grid/grid-shortcuts";
import { countLabel } from "@/lib/count-label";
import { Skeleton } from "@/components/ui/skeleton";
import { photoHref } from "@/lib/photo-href";
import { SelectionToolbar } from "@/app/(app)/photos/selection-toolbar";
import { HeaderBar } from "@/components/header-bar";
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
import { FavoriteButton } from "@/components/photo-actions/favorite-button";

export function FolderPhotosView({ folderId, folderName }: { folderId: string; folderName: string }) {
  const router = useRouter();
  const sel = useGridSelection();
  const { mode, setMode } = useGridView();
  const { columns, setColumns } = useGridColumns();
  const { sort, setSort } = useGridSort();
  const [total, setTotal] = useState<number | null>(null);
  const totalLabel = total !== null ? countLabel(total, "photo", "photos") : undefined;
  // Skeleton holds the subtitle line while the count loads.
  const countSubtitle = totalLabel ?? <Skeleton className="inline-block h-3 w-16 align-middle" />;
  const gridRef = useRef<PhotoGridHandle>(null);
  const actions = usePhotoActions({ gridRef, onTrashed: () => router.refresh() });

  return (
    <>
      {actions.element}
      {sel.count > 0 ? (
        <SelectionToolbar
          title={folderName}
          count={sel.count}
          totalLabel={totalLabel}
          onCancel={sel.clear}
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
                onPick={(targetId) => void actions.addToAlbumDirect([...sel.selected], targetId)}
                onCreateNew={() => actions.addToAlbum([...sel.selected])}
              />
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
          title={folderName}
          subtitle={countSubtitle}
          actions={
            <>
              <GridViewMenu mode={mode} onModeChange={setMode} />
              <GridSizeMenu columns={columns} onColumnsChange={setColumns} />
              <GridSortMenu sort={sort} onSortChange={setSort} />
            </>
          }
        />
      )}

      <PhotoCollectionProvider
        key={sort}
        endpoint={`/api/folders/${folderId}/photos`}
        params={new URLSearchParams({ sort })}
        urlForId={(id) => photoHref(id, undefined, sort)}
        baseUrl={`/albums/folder/${folderId}/photos`}
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
                  <EmptyTitle>No photos here yet</EmptyTitle>
                  <EmptyDescription>Photos from albums in this folder will appear here.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            }
          />
          <Lightbox />
          <GridShortcuts selectedIds={sel.selected} />
        </PhotoActionsProvider>
      </PhotoCollectionProvider>
    </>
  );
}
