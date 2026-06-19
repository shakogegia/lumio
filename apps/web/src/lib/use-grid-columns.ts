"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  COLUMNS_MAX,
  COLUMNS_MIN,
  DEFAULT_COLUMNS,
  GRID_COLUMNS_STORAGE_KEY as STORAGE_KEY,
} from "@/lib/grid-layout";

/**
 * Resolve the stored grid column count: an integer clamped to
 * [COLUMNS_MIN, COLUMNS_MAX], defaulting to DEFAULT_COLUMNS for missing/invalid
 * input. Pure for testability. (Number(null)/Number("") are 0, not NaN, so
 * null/empty must be handled before the numeric path.)
 */
export function parseGridColumns(stored: string | null): number {
  if (stored === null || stored.trim() === "") return DEFAULT_COLUMNS;
  const n = Number(stored);
  if (!Number.isFinite(n)) return DEFAULT_COLUMNS;
  return Math.min(COLUMNS_MAX, Math.max(COLUMNS_MIN, Math.round(n)));
}

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
  return parseGridColumns(localStorage.getItem(STORAGE_KEY));
}

// The server (and the first hydration pass) always assume the default; the real
// value is read on the client after mount. useSyncExternalStore swaps to the
// client snapshot without a hydration mismatch.
function getServerSnapshot(): number {
  return DEFAULT_COLUMNS;
}

/**
 * Global, persisted grid density as a column count (photos per row). Persisted
 * to localStorage so the choice carries across routes and reloads, and synced
 * across tabs via the `storage` event.
 */
export function useGridColumns() {
  const columns = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setColumns = useCallback((next: number) => {
    localStorage.setItem(STORAGE_KEY, String(next));
    // Keep the pre-paint CSS variable current so a later skeleton (e.g. on
    // client navigation to another grid) matches without a flash.
    document.documentElement.style.setProperty("--grid-columns", String(next));
    listeners.forEach((cb) => cb());
  }, []);

  return { columns, setColumns };
}
