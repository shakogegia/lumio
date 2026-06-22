"use client";

import { useRef, useState } from "react";
import { Download, Loader2, Trash2 } from "lucide-react";
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
import { GridShortcuts } from "@/components/photo-grid/grid-shortcuts";
import { countLabel } from "@/lib/count-label";
import { Skeleton } from "@/components/ui/skeleton";
import { photoHref } from "@/lib/photo-href";
import { computeFavoriteTarget } from "@lumio/shared";
import { SelectionToolbar } from "./selection-toolbar";
import { FavoriteButton } from "@/components/photo-actions/favorite-button";
import { ColorLabelMenu } from "@/components/photo-actions/color-label-menu";
import { AddToAlbumMenu } from "@/components/photo-actions/add-to-album-menu";
import { HeaderBar } from "@/components/header-bar";
import { usePhotoActions } from "@/components/photo-actions/use-photo-actions";
import { PhotoActionsProvider } from "@/components/photo-actions/photo-actions-context";
import { catalogApiUrl, catalogPath } from "@/lib/catalog-api";
import { useCatalog } from "@/lib/catalog-context";

export function LibraryView() {
  const { slug } = useCatalog();
  const sel = useGridSelection();
  const { mode, setMode } = useGridView();
  const { columns, setColumns } = useGridColumns();
  const { sort, setSort } = useGridSort();
  const [month, setMonth] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const gridRef = useRef<PhotoGridHandle>(null);
  const actions = usePhotoActions({ gridRef });
  const totalLabel = total !== null ? countLabel(total, "photo", "photos") : undefined;
  // Show a skeleton in the subtitle slot while the count loads (keeps the line reserved).
  const countSubtitle = totalLabel ?? <Skeleton className="inline-block h-3 w-16 align-middle" />;

  return (
    <>
      {actions.element}
      {sel.count > 0 ? (
        <SelectionToolbar
          title="Library"
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
          title="Library"
          subtitle={countSubtitle}
          actions={
            <>
              <GridViewMenu mode={mode} onModeChange={setMode} />
              <GridSizeMenu columns={columns} onColumnsChange={setColumns} />
              <GridSortMenu sort={sort} onSortChange={setSort} />
              <GridCalendarMenu
                facetsEndpoint={catalogApiUrl(slug, "/photos/calendar")}
                value={month}
                onChange={setMonth}
              />
            </>
          }
        />
      )}

      <PhotoCollectionProvider
        key={`${sort}:${month ?? ""}`}
        endpoint={catalogApiUrl(slug, "/photos")}
        params={new URLSearchParams(month ? { sort, month } : { sort })}
        urlForId={(id) => photoHref(slug, id, undefined, sort)}
        baseUrl={catalogPath(slug, "/photos")}
      >
        <CollectionTotalReporter onTotal={setTotal} />
        <PhotoActionsProvider value={actions}>
          <PhotoGrid
            apiRef={gridRef}
            mode={mode}
            columns={columns}
            selectedIds={sel.selected}
            onSelectionChange={sel.setSelected}
          />
          <Lightbox />
          <GridShortcuts selectedIds={sel.selected} />
        </PhotoActionsProvider>
      </PhotoCollectionProvider>
    </>
  );
}
