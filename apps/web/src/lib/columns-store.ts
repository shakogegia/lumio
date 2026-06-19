"use client";

import { useCallback, useSyncExternalStore } from "react";
import { COLUMNS_MAX, COLUMNS_MIN, DEFAULT_COLUMNS } from "@/lib/grid-layout";

/**
 * Resolve a stored grid column count: an integer clamped to
 * [COLUMNS_MIN, COLUMNS_MAX], defaulting to `fallback` for missing/invalid
 * input. Pure for testability. (Number(null)/Number("") are 0, not NaN, so
 * null/empty must be handled before the numeric path.)
 */
export function parseColumns(stored: string | null, fallback = DEFAULT_COLUMNS): number {
  if (stored === null || stored.trim() === "") return fallback;
  const n = Number(stored);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(COLUMNS_MAX, Math.max(COLUMNS_MIN, Math.round(n)));
}

/**
 * Build a persisted "columns per row" store bound to one localStorage key.
 * Each call owns its own same-document listener set, so independent stores
 * (the photo grid vs. the albums grid) don't notify each other. When `cssVar`
 * is set, writes also update that CSS variable on <html> so the matching
 * root-layout pre-paint script can paint at the chosen density before
 * hydration (no flash of the default). `defaultColumns` is the value used on
 * the server and for missing/invalid stored input.
 */
export function makeColumnsStore({
  storageKey,
  cssVar,
  defaultColumns = DEFAULT_COLUMNS,
}: {
  storageKey: string;
  cssVar: string | null;
  defaultColumns?: number;
}) {
  // Same-document subscribers. The native `storage` event only fires in *other*
  // tabs, so we keep our own listener set and notify it after a local write to
  // keep grids in the current tab in sync.
  const listeners = new Set<() => void>();

  function subscribe(onChange: () => void) {
    listeners.add(onChange);
    window.addEventListener("storage", onChange);
    return () => {
      listeners.delete(onChange);
      window.removeEventListener("storage", onChange);
    };
  }

  function getSnapshot(): number {
    return parseColumns(localStorage.getItem(storageKey), defaultColumns);
  }

  // The server (and the first hydration pass) always assume the default; the
  // real value is read on the client after mount. useSyncExternalStore swaps to
  // the client snapshot without a hydration mismatch.
  function getServerSnapshot(): number {
    return defaultColumns;
  }

  return function useColumns() {
    const columns = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

    const setColumns = useCallback((next: number) => {
      localStorage.setItem(storageKey, String(next));
      if (cssVar) {
        // Keep the pre-paint CSS variable current so the grid reflows live and a
        // later skeleton/SSR paint matches without a flash.
        document.documentElement.style.setProperty(cssVar, String(next));
      }
      listeners.forEach((cb) => cb());
    }, []);

    return { columns, setColumns };
  };
}
