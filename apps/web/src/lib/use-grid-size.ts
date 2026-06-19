"use client";

import { useCallback, useSyncExternalStore } from "react";
import { MIN_TILE, TILE_SIZE_MAX, TILE_SIZE_MIN, TILE_SIZE_STEP } from "@/lib/grid-layout";

const STORAGE_KEY = "lumio:grid-size";

/**
 * Resolve the stored grid tile size: an integer clamped to
 * [TILE_SIZE_MIN, TILE_SIZE_MAX] and snapped to the nearest TILE_SIZE_STEP,
 * defaulting to MIN_TILE for missing/invalid input. Pure for testability.
 */
export function parseGridSize(stored: string | null): number {
  if (stored === null || stored.trim() === "") return MIN_TILE;
  const n = Number(stored);
  if (!Number.isFinite(n)) return MIN_TILE;
  const clamped = Math.min(TILE_SIZE_MAX, Math.max(TILE_SIZE_MIN, n));
  const snapped =
    Math.round((clamped - TILE_SIZE_MIN) / TILE_SIZE_STEP) * TILE_SIZE_STEP + TILE_SIZE_MIN;
  return snapped;
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
  return parseGridSize(localStorage.getItem(STORAGE_KEY));
}

// The server (and the first hydration pass) always assume the default; the real
// value is read on the client after mount. useSyncExternalStore swaps to the
// client snapshot without a hydration mismatch.
function getServerSnapshot(): number {
  return MIN_TILE;
}

/**
 * Global, persisted grid tile size (the minimum/target tile width that sets the
 * column count). Persisted to localStorage so the choice carries across routes
 * and reloads, and synced across tabs via the `storage` event.
 */
export function useGridSize() {
  const size = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setSize = useCallback((next: number) => {
    localStorage.setItem(STORAGE_KEY, String(next));
    listeners.forEach((cb) => cb());
  }, []);

  return { size, setSize };
}
