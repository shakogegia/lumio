"use client";

import { useRef, useState } from "react";
import type { PhotoSort } from "@lumio/shared";
import { useGridSelection } from "@/lib/hooks/use-grid-selection";
import { useGridView } from "@/lib/hooks/use-grid-view";
import { useGridColumns } from "@/lib/hooks/use-grid-columns";
import { useGridSort } from "@/lib/hooks/use-grid-sort";
import { GridViewMenu } from "@/components/grid-view-menu";
import { GridSizeMenu } from "@/components/grid-size-menu";
import { GridSortMenu } from "@/components/grid-sort-menu";
import { GridCalendarMenu } from "@/components/grid-calendar-menu";
import { PhotoGrid, type PhotoGridHandle, PhotoCollectionProvider, CollectionTotalReporter, SelectionEditReporter, GridShortcuts } from "@/features/photo-grid";
import { Lightbox } from "@/features/lightbox";
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
  // Whether any selected photo is edited — reported up from inside the provider
  // (the toolbar renders outside it), so Download can offer edited vs original.
  const [anySelectedEdited, setAnySelectedEdited] = useState(false);
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
                clearOnFavorite={!!actionOptions?.dropOnUnfavorite}
                anyEdited={anySelectedEdited}
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
        <SelectionEditReporter selectedIds={sel.selected} onAnyEdited={setAnySelectedEdited} />
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
