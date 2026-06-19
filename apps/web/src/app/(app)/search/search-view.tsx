"use client";

import { useRef, useState } from "react";
import { useGridSize } from "@/lib/use-grid-size";
import { cn } from "@/lib/utils";
import { PhotoGrid } from "@/components/photo-grid/photo-grid";
import { SearchInput, type SearchInputHandle } from "./search-input";
import { SearchEmpty } from "./search-empty";
import { RecentSearches, loadRecentSearches, recordRecentSearch } from "./recent-searches";
import { type SearchFilters, paramsFor, scopeQuery, serialize } from "./filters";

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
  const { size } = useGridSize();

  const empty = isEmptyFilters(filters);

  function handleCommit(f: SearchFilters) {
    if (!isEmptyFilters(f)) setRecent(recordRecentSearch(f));
  }

  function applyRecent(f: SearchFilters) {
    setFilters(f);
    inputRef.current?.applyFilters(f);
  }

  return (
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
            <PhotoGrid
              key={serialize(filters)}
              minTile={size}
              endpoint="/api/search"
              params={paramsFor(filters)}
              hrefFor={(id) => `/photo/${id}?${scopeQuery(filters)}`}
              empty={<SearchEmpty />}
            />
          </div>
        ))}
    </div>
  );
}
