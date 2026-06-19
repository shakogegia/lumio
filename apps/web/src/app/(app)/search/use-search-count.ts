"use client";

import { useEffect, useState } from "react";
import type { SearchCount } from "@lumio/shared";
import { type SearchFilters, paramsFor, serialize } from "./filters";

/**
 * Total photos matching the current search filters, for the toolbar count.
 * Fetches `GET /api/search?count=1` when the (serialized) filters change —
 * sort-independent, so it never refetches on a sort change. Returns `null`
 * while loading, when disabled, or on error. Exposes the setter so the view
 * can keep the count in sync with in-place tile removal (e.g. after a delete).
 */
export function useSearchCount(filters: SearchFilters, enabled: boolean) {
  const [count, setCount] = useState<number | null>(null);
  const serialized = serialize(filters);

  useEffect(() => {
    if (!enabled) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCount(null);
      return;
    }
    let cancelled = false;
    setCount(null);
    const params = paramsFor(filters);
    params.set("count", "1");
    fetch(`/api/search?${params.toString()}`)
      .then((res) => (res.ok ? (res.json() as Promise<SearchCount>) : Promise.reject(new Error())))
      .then((data) => {
        if (!cancelled) setCount(data.total);
      })
      .catch(() => {
        if (!cancelled) setCount(null);
      });
    return () => {
      cancelled = true;
    };
    // `serialized` is the stable identity of `filters`; refetch only when it
    // changes (or `enabled` flips). `filters`/`paramsFor` are intentionally
    // excluded — they'd refetch every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialized, enabled]);

  return [count, setCount] as const;
}
