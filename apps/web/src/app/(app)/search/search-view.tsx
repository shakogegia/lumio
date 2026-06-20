"use client";

import { useEffect, useRef, useState } from "react";
import { Download, FolderPlus, Loader2, SquareCheckBig, Trash2, X } from "lucide-react";
import { useGridColumns } from "@/lib/use-grid-columns";
import { useGridSort } from "@/lib/use-grid-sort";
import { useGridView } from "@/lib/use-grid-view";
import { useGridSelection } from "@/lib/use-grid-selection";
import { GridSortMenu } from "@/components/grid-sort-menu";
import { GridSizeMenu } from "@/components/grid-size-menu";
import { GridViewMenu } from "@/components/grid-view-menu";
import { Button } from "@/components/ui/button";
import { ColorLabelMenu } from "@/components/photo-actions/color-label-menu";
import { usePhotoActions } from "@/components/photo-actions/use-photo-actions";
import { PhotoActionsProvider } from "@/components/photo-actions/photo-actions-context";
import { cn } from "@/lib/utils";
import { PhotoGrid, type PhotoGridHandle } from "@/components/photo-grid/photo-grid";
import { PhotoCollectionProvider } from "@/components/photo-grid/photo-collection";
import { Lightbox } from "@/components/photo-grid/lightbox";
import { SearchInput, type SearchInputHandle } from "./search-input";
import { SearchEmpty } from "./search-empty";
import { RecentSearches, loadRecentSearches, recordRecentSearch } from "./recent-searches";
import { type SearchFilters, paramsFor, scopeQuery, serialize } from "./filters";
import { useSearchCount } from "./use-search-count";

const EMPTY: SearchFilters = { albums: [], q: "" };

function isEmptyFilters(f: SearchFilters): boolean {
  return f.albums.length === 0 && f.q === "";
}

export function SearchView() {
  // `active` flips on first focus: the box rises to the top and the panel shows.
  const [active, setActive] = useState(false);
  // Live filters, updated (debounced) as the user types / tags.
  const [filters, setFilters] = useState<SearchFilters>(EMPTY);
  // Lazy init (not an effect) reads localStorage once on mount. Safe for SSR/
  // hydration: recents only render after focus, long after the initial paint.
  const [recent, setRecent] = useState<SearchFilters[]>(loadRecentSearches);
  const inputRef = useRef<SearchInputHandle>(null);
  const { columns, setColumns } = useGridColumns();
  const { sort, setSort } = useGridSort();
  const { mode, setMode } = useGridView();
  const sel = useGridSelection();
  const gridRef = useRef<PhotoGridHandle>(null);

  const empty = isEmptyFilters(filters);
  const [searchCount, setSearchCount] = useSearchCount(filters, active && !empty);
  const actions = usePhotoActions({
    gridRef,
    // Keep the result count in step with menu- or toolbar-driven trashes.
    onTrashed: (ids) =>
      setSearchCount((c) => (c === null ? c : Math.max(0, c - ids.length))),
  });

  // The result set changes when the query changes, so any selection would point
  // at photos no longer shown. Drop it and leave select mode whenever the query
  // changes. Keyed on the serialized filters — the same value that remounts the
  // grid below — so the toolbar resets in lockstep with the grid. `sel.cancel`
  // is stable (useCallback), so this only fires on an actual query change; the
  // first run (initial filters) is a harmless no-op.
  // Destructured so the dep is a plain stable identifier — eslint resolves the
  // member access `sel.cancel` to the whole `sel` object (recreated each render)
  // and would otherwise demand it as a dep, causing a re-run loop.
  const { cancel: resetSelection } = sel;
  const serialized = serialize(filters);
  useEffect(() => {
    resetSelection();
  }, [serialized, resetSelection]);

  function handleCommit(f: SearchFilters) {
    if (!isEmptyFilters(f)) setRecent(recordRecentSearch(f));
  }

  function applyRecent(f: SearchFilters) {
    setFilters(f);
    inputRef.current?.applyFilters(f);
  }

  return (
    <>
      {actions.element}
      <div
        className={cn(
          // Center the box on entry by padding the top; collapse the padding when
          // active so it rises to the top. Animating padding (not a transform) keeps
          // the box in flow, so its sticky header band never sweeps over the grid.
          "transition-[padding] duration-500 ease-out",
          active ? "pt-0" : "pt-[32vh]",
        )}
      >
        {/* Sticky search header. The full-width band (-mx-6/px-6 bg-background) only
            paints once active, so the centered hero shows just the pill — no stripe. */}
        <div
          className={cn(
            "sticky top-0 z-20 -mx-6 px-6 transition-colors duration-300",
            active ? "bg-background py-3" : "py-0",
          )}
        >
          <div className="mx-auto w-full max-w-2xl">
            <div
              className={cn(
                "overflow-hidden text-center transition-all duration-300",
                active ? "max-h-0 opacity-0" : "mb-6 max-h-40 opacity-100",
              )}
            >
              <h1 className="text-3xl font-semibold">Search library</h1>
              <p className="mt-2 text-sm text-muted-foreground">Type @ to filter by album</p>
            </div>
            <SearchInput
              ref={inputRef}
              compact={active}
              onActivate={() => setActive(true)}
              onChange={setFilters}
              onCommit={handleCommit}
            />
          </div>
        </div>

        {active &&
          (empty ? (
            // Empty query: don't search — surface recent searches instead.
            <RecentSearches items={recent} onPick={applyRecent} />
          ) : (
            <div className="pt-2">
              {/* Two-state toolbar row. Inline (not the sticky HeaderBar/SelectionToolbar)
                  because the sticky search box already owns top-0 above. */}
              <div className="mb-2 flex items-center justify-between gap-4">
                {sel.selectMode ? (
                  <span className="text-sm font-medium">
                    {sel.count > 0 ? `${sel.count} selected` : "Select photos"}
                  </span>
                ) : (
                  <span className="text-sm text-muted-foreground">
                    {searchCount !== null
                      ? `${searchCount.toLocaleString()} ${searchCount === 1 ? "photo" : "photos"}`
                      : null}
                  </span>
                )}
                <div className="flex items-center gap-2">
                  {sel.selectMode ? (
                    <>
                      <ColorLabelMenu
                        disabled={sel.count === 0 || actions.pending.label}
                        onPick={(label) => void actions.applyLabel([...sel.selected], label)}
                      />
                      <Button
                        variant="outline"
                        size="icon-sm"
                        disabled={sel.count === 0}
                        onClick={() => actions.addToAlbum([...sel.selected])}
                        aria-label="Add to album"
                        title="Add to album"
                      >
                        <FolderPlus aria-hidden />
                      </Button>
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
                        onClick={() => void actions.trash([...sel.selected], { onSuccess: sel.cancel })}
                        aria-label="Delete"
                        title="Delete"
                      >
                        {actions.pending.trash ? <Loader2 className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
                      </Button>
                      <Button
                        variant="outline"
                        size="icon-sm"
                        onClick={sel.cancel}
                        aria-label="Cancel"
                        title="Cancel"
                      >
                        <X aria-hidden />
                      </Button>
                    </>
                  ) : (
                    <>
                      <GridViewMenu mode={mode} onModeChange={setMode} />
                      <GridSizeMenu columns={columns} onColumnsChange={setColumns} />
                      <GridSortMenu sort={sort} onSortChange={setSort} />
                      <Button
                        variant="outline"
                        size="icon-sm"
                        onClick={sel.enter}
                        aria-label="Select"
                        title="Select"
                      >
                        <SquareCheckBig aria-hidden />
                      </Button>
                    </>
                  )}
                </div>
              </div>
              <PhotoCollectionProvider
                key={`${serialized}:${sort}`}
                endpoint="/api/search"
                params={paramsFor(filters, sort)}
                urlForId={(id) => `/photo/${id}?${scopeQuery(filters, sort)}`}
                baseUrl="/search"
              >
                <PhotoActionsProvider value={actions}>
                  <PhotoGrid
                    apiRef={gridRef}
                    mode={mode}
                    columns={columns}
                    selectMode={sel.selectMode}
                    selectedIds={sel.selected}
                    onSelectionChange={sel.setSelected}
                    empty={<SearchEmpty />}
                  />
                  <Lightbox />
                </PhotoActionsProvider>
              </PhotoCollectionProvider>
            </div>
          ))}
      </div>

    </>
  );
}
