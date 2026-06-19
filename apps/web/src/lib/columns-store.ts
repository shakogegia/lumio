"use client";

import { useCallback, useSyncExternalStore } from "react";
import { COLUMNS_MAX, COLUMNS_MIN, DEFAULT_COLUMNS } from "@/lib/grid-layout";

/**
 * Resolve a stored grid column count: an integer clamped to
 * [COLUMNS_MIN, COLUMNS_MAX], defaulting to DEFAULT_COLUMNS for missing/invalid
 * input. Pure for testability. (Number(null)/Number("") are 0, not NaN, so
 * null/empty must be handled before the numeric path.)
 */
export function parseColumns(stored: string | null): number {
  if (stored === null || stored.trim() === "") return DEFAULT_COLUMNS;
  const n = Number(stored);
  if (!Number.isFinite(n)) return DEFAULT_COLUMNS;
  return Math.min(COLUMNS_MAX, Math.max(COLUMNS_MIN, Math.round(n)));
}

/**
 * Build a persisted "columns per row" store bound to one localStorage key.
 * Each call owns its own same-document listener set, so independent stores
 * (the photo grid vs. the albums grid) don't notify each other. When
 * `syncCssVar` is true, writes also update the `--grid-columns` CSS variable
 * that the root-layout pre-paint script reads (photo grid only).
 */
export function makeColumnsStore({
  storageKey,
  syncCssVar,
}: {
  storageKey: string;
  syncCssVar: boolean;
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
    return parseColumns(localStorage.getItem(storageKey));
  }

  // The server (and the first hydration pass) always assume the default; the
  // real value is read on the client after mount. useSyncExternalStore swaps to
  // the client snapshot without a hydration mismatch.
  function getServerSnapshot(): number {
    return DEFAULT_COLUMNS;
  }

  return function useColumns() {
    const columns = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

    const setColumns = useCallback((next: number) => {
      localStorage.setItem(storageKey, String(next));
      if (syncCssVar) {
        // Keep the pre-paint CSS variable current so a later skeleton matches
        // without a flash.
        document.documentElement.style.setProperty("--grid-columns", String(next));
      }
      listeners.forEach((cb) => cb());
    }, []);

    return { columns, setColumns };
  };
}
