"use client";

import { useCallback, useSyncExternalStore } from "react";
import { coercePhotoSort, DEFAULT_PHOTO_SORT, type PhotoSort } from "@lumio/shared";

const STORAGE_KEY = "lumio:grid-sort";

/** Resolve the stored grid sort, defaulting to taken-date newest for
 *  missing/invalid input. Pure for testability. */
export function parseGridSort(stored: string | null): PhotoSort {
  return coercePhotoSort(stored ?? undefined);
}

// Same-document subscribers. The native `storage` event only fires in *other*
// tabs, so we keep our own listener set and notify it after a local write to keep
// grids in the current tab in sync.
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function getSnapshot(): PhotoSort {
  return parseGridSort(localStorage.getItem(STORAGE_KEY));
}

// The server (and the first hydration pass) assume the default; the real value is
// read on the client after mount. useSyncExternalStore swaps to the client
// snapshot without a hydration mismatch.
function getServerSnapshot(): PhotoSort {
  return DEFAULT_PHOTO_SORT;
}

/**
 * Global, persisted photo sort order. Persisted to localStorage so the choice
 * carries across routes and reloads, and synced across tabs via the `storage`
 * event and across grids in the same tab via the local listener set.
 */
export function useGridSort() {
  const sort = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setSort = useCallback((next: PhotoSort) => {
    localStorage.setItem(STORAGE_KEY, next);
    listeners.forEach((cb) => cb());
  }, []);

  return { sort, setSort };
}
