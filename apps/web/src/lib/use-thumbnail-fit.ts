"use client";

import { useCallback, useSyncExternalStore } from "react";

export type ThumbnailFit = "cover" | "contain";

const STORAGE_KEY = "lumio:thumbnail-fit";

function isFit(value: string | null): value is ThumbnailFit {
  return value === "cover" || value === "contain";
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

function getSnapshot(): ThumbnailFit {
  const stored = localStorage.getItem(STORAGE_KEY);
  return isFit(stored) ? stored : "cover";
}

// The server (and the first hydration pass) always assume the default; the real
// value is read on the client after mount. useSyncExternalStore swaps to the
// client snapshot without a hydration mismatch.
function getServerSnapshot(): ThumbnailFit {
  return "cover";
}

/**
 * Global, persisted preference for how grid thumbnails fill their square tiles:
 * "cover" (fill + crop, the default) or "contain" (whole photo, letterboxed).
 *
 * Persisted to localStorage so the choice carries across routes (Library ↔
 * Album) and reloads, and synced across tabs via the `storage` event.
 */
export function useThumbnailFit() {
  const fit = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const toggle = useCallback(() => {
    const next: ThumbnailFit = getSnapshot() === "cover" ? "contain" : "cover";
    localStorage.setItem(STORAGE_KEY, next);
    listeners.forEach((cb) => cb());
  }, []);

  return { fit, toggle };
}
