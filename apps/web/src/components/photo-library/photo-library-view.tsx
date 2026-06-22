"use client";

import { useRef, useState } from "react";
import type { PhotoSort } from "@lumio/shared";
import { useGridSelection } from "@/lib/use-grid-selection";
import { useGridView } from "@/lib/use-grid-view";
import { useGridColumns } from "@/lib/use-grid-columns";
import { useGridSort } from "@/lib/use-grid-sort";
import { GridViewMenu } from "@/components/grid-view-menu";
import { GridSizeMenu } from "@/components/grid-size-menu";
import { GridSortMenu } from "@/components/grid-sort-menu";
import { GridCalendarMenu } from "@/components/grid-calendar-menu";
import { PhotoGrid, type PhotoGridHandle } from "@/components/photo-grid/photo-grid";
import { PhotoCollectionProvider } from "@/components/photo-grid/photo-collection";
import { CollectionTotalReporter } from "@/components/photo-grid/collection-total-reporter";
import { Lightbox } from "@/components/photo-grid/lightbox";
import { GridShortcuts } from "@/components/photo-grid/grid-shortcuts";
import { countLabel } from "@/lib/count-label";
import { Skeleton } from "@/components/ui/skeleton";
import { HeaderBar } from "@/components/header-bar";
import { SelectionToolbar } from "@/components/photo-actions/selection-toolbar";
import { SelectionActions } from "@/components/photo-actions/selection-actions";
import { usePhotoActions, type PhotoActions } from "@/components/photo-actions/use-photo-actions";
import { PhotoActionsProvider } from "@/components/photo-actions/photo-actions-context";

/** The paginated source + lightbox URLs for the current sort/month. */
export interface PhotoCollectionSource {
  endpoint: string;
  params: URLSearchParams;
  urlForId: (id: string) => string;
  baseUrl: string;
  /** Forces a provider remount when the filter changes (e.g. `${sort}:${month}`). */
  key: string;
}

export interface PhotoLibraryViewProps {
  /** Build the collection from the grid's current sort + month. */
  collection: (args: { sort: PhotoSort; month: string | null }) => PhotoCollectionSource;
  title: React.ReactNode;
  noun?: [singular: string, plural: string];
  empty?: React.ReactNode;
  /** When set, render the month calendar menu and own the month state. */
  calendar?: { facetsEndpoint: string };
  /** Forwarded to usePhotoActions for view-specific behavior. */
  actionOptions?: {
    excludeAlbumId?: string;
    albumCover?: { albumId: string; coverPhotoId: string | null };
    trashDescription?: string;
    onTrashed?: (ids: string[]) => void;
    dropOnUnfavorite?: boolean;
  };
  /** Rendered between the toolbar and the grid (e.g. the folders section). */
  aboveGrid?: React.ReactNode;
  /** Extra view-specific buttons appended to the header toolbar (after the grid
   *  menus), e.g. an album's "Upload to album" / "Download album". */
  headerActions?: React.ReactNode;
  /** Extra view-specific buttons appended to the selection toolbar (after the
   *  standard bulk actions), wired to the grid internals — e.g. an album's
   *  "Set as cover" / "Remove from album". */
  selectionActions?: (ctx: {
    actions: PhotoActions;
    selectedIds: Set<string>;
    clearSelection: () => void;
  }) => React.ReactNode;
}

export function PhotoLibraryView({
  collection,
  title,
  noun = ["photo", "photos"],
  empty,
  calendar,
  actionOptions,
  aboveGrid,
  headerActions,
  selectionActions,
}: PhotoLibraryViewProps) {
  const sel = useGridSelection();
  const { mode, setMode } = useGridView();
  const { columns, setColumns } = useGridColumns();
  const { sort, setSort } = useGridSort();
  const [month, setMonth] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);
  const gridRef = useRef<PhotoGridHandle>(null);
  const actions = usePhotoActions({ gridRef, ...actionOptions });

  const src = collection({ sort, month });
  const totalLabel = total !== null ? countLabel(total, noun[0], noun[1]) : undefined;
  const countSubtitle = totalLabel ?? <Skeleton className="inline-block h-3 w-16 align-middle" />;

  return (
    <>
      {actions.element}
      {sel.count > 0 ? (
        <SelectionToolbar
          title={title}
          count={sel.count}
          totalLabel={totalLabel}
          onCancel={sel.clear}
          actions={
            <>
              {selectionActions?.({
                actions,
                selectedIds: sel.selected,
                clearSelection: sel.clear,
              })}
              <SelectionActions
                actions={actions}
                selectedIds={sel.selected}
                gridRef={gridRef}
                clearSelection={sel.clear}
              />
            </>
          }
        />
      ) : (
        <HeaderBar
          title={title}
          subtitle={countSubtitle}
          actions={
            <>
              {headerActions}
              <GridViewMenu mode={mode} onModeChange={setMode} />
              <GridSizeMenu columns={columns} onColumnsChange={setColumns} />
              <GridSortMenu sort={sort} onSortChange={setSort} />
              {calendar && (
                <GridCalendarMenu
                  facetsEndpoint={calendar.facetsEndpoint}
                  value={month}
                  onChange={setMonth}
                />
              )}
            </>
          }
        />
      )}

      <PhotoCollectionProvider
        key={src.key}
        endpoint={src.endpoint}
        params={src.params}
        urlForId={src.urlForId}
        baseUrl={src.baseUrl}
      >
        <CollectionTotalReporter onTotal={setTotal} />
        <PhotoActionsProvider value={actions}>
          {aboveGrid}
          <PhotoGrid
            apiRef={gridRef}
            mode={mode}
            columns={columns}
            selectedIds={sel.selected}
            onSelectionChange={sel.setSelected}
            empty={empty}
          />
          <Lightbox />
          <GridShortcuts selectedIds={sel.selected} />
        </PhotoActionsProvider>
      </PhotoCollectionProvider>
    </>
  );
}
