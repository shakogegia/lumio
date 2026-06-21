"use client";

import { useRef, useState } from "react";
import { Download, Heart, Loader2, Trash2 } from "lucide-react";
import { computeFavoriteTarget } from "@lumio/shared";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
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
import { countLabel } from "@/lib/count-label";
import { Skeleton } from "@/components/ui/skeleton";
import { photoHref } from "@/lib/photo-href";
import { SelectionToolbar } from "@/app/(app)/photos/selection-toolbar";
import { ColorLabelMenu } from "@/components/photo-actions/color-label-menu";
import { AddToAlbumMenu } from "@/components/photo-actions/add-to-album-menu";
import { FavoriteButton } from "@/components/photo-actions/favorite-button";
import { HeaderBar } from "@/components/header-bar";
import { usePhotoActions } from "@/components/photo-actions/use-photo-actions";
import { PhotoActionsProvider } from "@/components/photo-actions/photo-actions-context";

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
  const sel = useGridSelection();
  const { mode, setMode } = useGridView();
  const { columns, setColumns } = useGridColumns();
  const { sort, setSort } = useGridSort();
  const [total, setTotal] = useState<number | null>(null);
  const gridRef = useRef<PhotoGridHandle>(null);
  const actions = usePhotoActions({ gridRef, dropOnUnfavorite: true });
  const totalLabel = total !== null ? countLabel(total, "photo", "photos") : undefined;
  // Show a skeleton in the subtitle slot while the count loads (keeps the line reserved).
  const countSubtitle = totalLabel ?? <Skeleton className="inline-block h-3 w-16 align-middle" />;

  return (
    <>
      {actions.element}
      {sel.count > 0 ? (
        <SelectionToolbar
          title="Favorites"
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
                  void actions.favorite([...sel.selected], target, { onSuccess: sel.clear });
                }}
              />
              <ColorLabelMenu
                disabled={sel.count === 0 || actions.pending.label}
                onPick={(label) => void actions.applyLabel([...sel.selected], label)}
              />
              <AddToAlbumMenu
                disabled={sel.count === 0}
                excludeAlbumId={actions.excludeAlbumId}
                onPick={(albumId) => void actions.addToAlbumDirect([...sel.selected], albumId)}
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
          title="Favorites"
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
        key={`fav:${sort}`}
        endpoint="/api/photos"
        params={new URLSearchParams({ sort, favorite: "true" })}
        urlForId={(id) => photoHref(id, undefined, sort)}
        baseUrl="/favorites"
      >
        <CollectionTotalReporter onTotal={setTotal} />
        <PhotoActionsProvider value={actions}>
          <PhotoGrid
            apiRef={gridRef}
            mode={mode}
            columns={columns}
            selectedIds={sel.selected}
            onSelectionChange={sel.setSelected}
            empty={FAVORITES_EMPTY}
          />
          <Lightbox />
        </PhotoActionsProvider>
      </PhotoCollectionProvider>
    </>
  );
}
