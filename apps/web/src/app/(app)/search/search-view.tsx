"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { useGridColumns } from "@/lib/use-grid-columns";
import { useGridSort } from "@/lib/use-grid-sort";
import { useGridView } from "@/lib/use-grid-view";
import { useGridSelection } from "@/lib/use-grid-selection";
import { downloadSelection } from "@/lib/download-client";
import { GridSortMenu } from "@/components/grid-sort-menu";
import { GridSizeMenu } from "@/components/grid-size-menu";
import { GridViewMenu } from "@/components/grid-view-menu";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/confirm-dialog";
import { ColorLabelMenu } from "@/components/photo-actions/color-label-menu";
import { AddToAlbumDialog } from "@/components/photo-actions/add-to-album-dialog";
import type { ColorLabel } from "@lumio/shared";
import { cn } from "@/lib/utils";
import { PhotoGrid, type PhotoGridHandle } from "@/components/photo-grid/photo-grid";
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
  const { confirm, confirmDialog } = useConfirm();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [labelPending, setLabelPending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const empty = isEmptyFilters(filters);
  const [searchCount, setSearchCount] = useSearchCount(filters, active && !empty);

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

  async function handleDelete() {
    const ids = sel.selected;
    if (ids.size === 0 || deleting) return;
    const label = `${ids.size} ${ids.size === 1 ? "photo" : "photos"}`;
    const ok = await confirm({
      title: `Move ${label} to Trash?`,
      description: "They'll be moved to Trash. You can restore them later.",
      confirmLabel: "Move to Trash",
      destructive: true,
    });
    if (!ok) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/photos/trash", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: [...ids] }),
      });
      if (!res.ok) throw new Error("trash failed");
      // Drop the tiles in place (no remount) and leave select mode.
      gridRef.current?.removePhotos(ids);
      // Keep the toolbar count consistent with the tiles we just removed.
      setSearchCount((c) => (c === null ? c : Math.max(0, c - ids.size)));
      sel.cancel();
    } catch {
      toast.error("Failed to move photos to Trash.");
    } finally {
      setDeleting(false);
    }
  }

  async function handleDownload() {
    const ids = [...sel.selected];
    if (ids.length === 0 || downloading) return;
    setDownloading(true);
    try {
      await downloadSelection(ids);
      // Clear the selection on success while staying in select mode, mirroring
      // the color-label flow — the batch is done, but you may pick another set.
      sel.clear();
    } catch {
      toast.error("Failed to download photos.");
    } finally {
      setDownloading(false);
    }
  }

  async function applyLabel(label: ColorLabel | null) {
    if (labelPending) return;
    const ids = sel.selected;
    setLabelPending(true);
    try {
      const res = await fetch("/api/photos/color-label", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ photoIds: [...ids], label }),
      });
      if (!res.ok) throw new Error("label failed");
      // Optimistically repaint the client-fetched grid, keeping the selection
      // intact so the user can keep acting on the same photos.
      gridRef.current?.patchPhotos(ids, { colorLabel: label });
    } catch {
      toast.error("Failed to apply label.");
    } finally {
      setLabelPending(false);
    }
  }

  return (
    <>
      {confirmDialog}
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
                        disabled={sel.count === 0 || labelPending}
                        onPick={(label) => void applyLabel(label)}
                      />
                      <Button
                        size="sm"
                        disabled={sel.count === 0}
                        onClick={() => setDialogOpen(true)}
                      >
                        Add to album
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={sel.count === 0 || downloading}
                        onClick={() => void handleDownload()}
                      >
                        <Download aria-hidden />
                        {downloading ? "Preparing…" : "Download"}
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={sel.count === 0 || deleting}
                        onClick={() => void handleDelete()}
                      >
                        {deleting ? "Deleting…" : "Delete"}
                      </Button>
                      <Button variant="outline" size="sm" onClick={sel.cancel}>
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <>
                      <GridViewMenu mode={mode} onModeChange={setMode} />
                      <GridSizeMenu columns={columns} onColumnsChange={setColumns} />
                      <GridSortMenu sort={sort} onSortChange={setSort} />
                      <Button variant="outline" size="sm" onClick={sel.enter}>
                        Select
                      </Button>
                    </>
                  )}
                </div>
              </div>
              <PhotoGrid
                key={`${serialized}:${sort}`}
                apiRef={gridRef}
                mode={mode}
                columns={columns}
                endpoint="/api/search"
                params={paramsFor(filters, sort)}
                hrefFor={(id) => `/photo/${id}?${scopeQuery(filters, sort)}`}
                empty={<SearchEmpty />}
                selectMode={sel.selectMode}
                selectedIds={sel.selected}
                onSelectionChange={sel.setSelected}
              />
            </div>
          ))}
      </div>

      <AddToAlbumDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        photoIds={[...sel.selected]}
        onAdded={() => {
          // Keep the selection and select mode so the user can keep acting on
          // the same photos after adding them to an album.
          setDialogOpen(false);
        }}
      />
    </>
  );
}
