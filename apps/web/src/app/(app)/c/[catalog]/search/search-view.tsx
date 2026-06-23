"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useGridColumns } from "@/lib/use-grid-columns";
import { useGridSort } from "@/lib/use-grid-sort";
import { useGridView } from "@/lib/use-grid-view";
import { useGridSelection } from "@/lib/use-grid-selection";
import { GridSortMenu } from "@/components/grid-sort-menu";
import { GridSizeMenu } from "@/components/grid-size-menu";
import { GridViewMenu } from "@/components/grid-view-menu";
import { GridCalendarMenu } from "@/components/grid-calendar-menu";
import { Button } from "@/components/ui/button";
import { usePhotoActions } from "@/components/photo-actions/use-photo-actions";
import { SelectionActions } from "@/components/photo-actions/selection-actions";
import { PhotoActionsProvider } from "@/components/photo-actions/photo-actions-context";
import { cn } from "@/lib/utils";
import { PhotoGrid, type PhotoGridHandle, PhotoCollectionProvider, GridShortcuts } from "@/features/photo-grid";
import { Lightbox } from "@/features/lightbox";
import { SearchInput, type SearchInputHandle } from "./search-input";
import { SearchEmpty } from "./search-empty";
import { RecentSearches, loadRecentSearches, recordRecentSearch } from "./recent-searches";
import { type SearchFilters, paramsFor, scopeQuery, serialize } from "./filters";
import { useSearchCount } from "./use-search-count";
import { countLabel } from "@/lib/count-label";
import { catalogApiUrl, catalogPath } from "@/lib/catalog-api";
import { useCatalog } from "@/lib/catalog-context";

const EMPTY: SearchFilters = { albums: [], q: "" };

function isEmptyFilters(f: SearchFilters): boolean {
  return f.albums.length === 0 && f.q === "";
}

export function SearchView() {
  const { slug } = useCatalog();
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
  const [month, setMonth] = useState<string | null>(null);
  const sel = useGridSelection();
  const gridRef = useRef<PhotoGridHandle>(null);

  const empty = isEmptyFilters(filters);
  const [searchCount, setSearchCount] = useSearchCount(filters, active && !empty, month);
  const actions = usePhotoActions({
    gridRef,
    // Keep the result count in step with menu- or toolbar-driven trashes.
    onTrashed: (ids) =>
      setSearchCount((c) => (c === null ? c : Math.max(0, c - ids.length))),
  });

  // The result set changes when the query OR the month filter changes, so any
  // selection would point at photos no longer shown. Clear it whenever either
  // changes. Keyed on the serialized filters + month — the same values that
  // remount the grid below — so the toolbar resets in lockstep with the grid.
  // `sel.clear` is stable (useCallback), so this only fires on an actual
  // query/month change; the first run (initial filters) is a harmless no-op.
  // Destructured so the dep is a plain stable identifier — eslint resolves the
  // member access `sel.clear` to the whole `sel` object (recreated each render)
  // and would otherwise demand it as a dep, causing a re-run loop.
  const { clear: resetSelection } = sel;
  const serialized = serialize(filters);
  useEffect(() => {
    resetSelection();
  }, [serialized, month, resetSelection]);

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
        {/* Sticky search header. The full-width band (-mx-4/px-4 bg-background) only
            paints once active, so the centered hero shows just the pill — no stripe. */}
        <div
          className={cn(
            "sticky top-0 z-20 -mx-4 px-4 transition-colors duration-300",
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
                {sel.count > 0 ? (
                  <span className="text-xs font-medium">
                    {searchCount !== null
                      ? `${countLabel(searchCount, "photo", "photos")} · ${sel.count} selected`
                      : `${sel.count} selected`}
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {searchCount !== null ? countLabel(searchCount, "photo", "photos") : null}
                  </span>
                )}
                <div className="flex items-center gap-2">
                  {sel.count > 0 ? (
                    <>
                      <SelectionActions
                        actions={actions}
                        selectedIds={sel.selected}
                        gridRef={gridRef}
                        clearSelection={sel.clear}
                      />
                      <Button
                        variant="outline"
                        size="icon-sm"
                        onClick={sel.clear}
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
                      <GridCalendarMenu
                        facetsEndpoint={catalogApiUrl(slug, `/search/calendar?${paramsFor(filters).toString()}`)}
                        value={month}
                        onChange={setMonth}
                      />
                    </>
                  )}
                </div>
              </div>
              <PhotoCollectionProvider
                key={`${serialized}:${sort}:${month ?? ""}`}
                endpoint={catalogApiUrl(slug, "/search")}
                params={(() => {
                  const p = paramsFor(filters, sort);
                  if (month) p.set("month", month);
                  return p;
                })()}
                urlForId={(id) => catalogPath(slug, `/photo/${id}?${scopeQuery(filters, sort)}`)}
                baseUrl={catalogPath(slug, "/search")}
              >
                <PhotoActionsProvider value={actions}>
                  <PhotoGrid
                    apiRef={gridRef}
                    mode={mode}
                    columns={columns}
                    selectedIds={sel.selected}
                    onSelectionChange={sel.setSelected}
                    empty={<SearchEmpty />}
                  />
                  <Lightbox />
                  <GridShortcuts selectedIds={sel.selected} />
                </PhotoActionsProvider>
              </PhotoCollectionProvider>
            </div>
          ))}
      </div>
    </>
  );
}
