"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import { loadAllOptions } from "./facets";
import { type SearchFilters, serialize } from "./filters";

const KEY = "lumio.recentSearches";
const MAX = 8;

function isEmptyFilters(f: SearchFilters): boolean {
  return f.albums.length === 0 && f.q === "";
}

/** Load recent searches (most-recent first) from localStorage. */
export function loadRecentSearches(): SearchFilters[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (f): f is SearchFilters =>
        !!f &&
        Array.isArray((f as SearchFilters).albums) &&
        typeof (f as SearchFilters).q === "string",
    );
  } catch {
    return [];
  }
}

/**
 * Record a search at the front of the recents (deduped, capped). Empty searches
 * are ignored. Returns the new list so callers can update state without re-reading.
 */
export function recordRecentSearch(filters: SearchFilters): SearchFilters[] {
  const existing = loadRecentSearches();
  if (typeof window === "undefined" || isEmptyFilters(filters)) return existing;
  const key = serialize(filters);
  const next = [filters, ...existing.filter((f) => serialize(f) !== key)].slice(0, MAX);
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // ignore quota / disabled storage
  }
  return next;
}

/**
 * Shown when the search box is focused but empty: a list of the user's recent
 * searches (or a hint when there are none). Album ids are resolved to names via
 * the facet registry so each row reads the way the chips do.
 */
export function RecentSearches({
  items,
  onPick,
}: {
  items: SearchFilters[];
  onPick: (filters: SearchFilters) => void;
}) {
  const [albumNames, setAlbumNames] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    let active = true;
    void loadAllOptions()
      .then((opts) => {
        if (!active) return;
        const map = new Map<string, string>();
        for (const o of opts) if (o.facetKey === "album") map.set(o.value, o.label);
        setAlbumNames(map);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  if (items.length === 0) {
    return (
      <div className="mx-auto w-full max-w-2xl pt-10 text-center text-sm text-muted-foreground">
        Your recent searches will show up here.
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-2xl pt-4">
      <h2 className="mb-1 px-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        Recent
      </h2>
      <ul className="flex flex-col">
        {items.map((filters, i) => (
          <li key={i}>
            <button
              type="button"
              onClick={() => onPick(filters)}
              className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted"
            >
              <Clock className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              <span className="flex flex-wrap items-center gap-1.5 text-sm">
                {filters.albums.map((id) => (
                  <span
                    key={id}
                    className="rounded-full border border-border bg-background px-2 py-0.5 text-xs text-foreground"
                  >
                    <span className="text-muted-foreground">Album:</span>{" "}
                    {albumNames.get(id) ?? "…"}
                  </span>
                ))}
                {filters.q && <span>{filters.q}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
