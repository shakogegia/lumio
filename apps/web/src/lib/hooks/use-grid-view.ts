"use client";

import { useCallback, useSyncExternalStore } from "react";

export type GridViewMode = "fill" | "fit" | "card";

const STORAGE_KEY = "lumio:grid-view";
// Previous two-state key; migrated on read so the existing preference carries over.
const LEGACY_KEY = "lumio:thumbnail-fit";

function isMode(value: string | null): value is GridViewMode {
  return value === "fill" || value === "fit" || value === "card";
}

/**
 * Resolve the stored grid view mode. Prefers a valid value under the current
 * key; otherwise migrates the legacy cover/contain toggle (cover→fill,
 * contain→fit); otherwise defaults to "fill". Pure for testability.
 */
export function parseGridView(stored: string | null, legacy: string | null): GridViewMode {
  if (isMode(stored)) return stored;
  if (legacy === "cover") return "fill";
  if (legacy === "contain") return "fit";
  return "fill";
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

function getSnapshot(): GridViewMode {
  return parseGridView(localStorage.getItem(STORAGE_KEY), localStorage.getItem(LEGACY_KEY));
}

// The server (and the first hydration pass) always assume the default; the real
// value is read on the client after mount. useSyncExternalStore swaps to the
// client snapshot without a hydration mismatch.
function getServerSnapshot(): GridViewMode {
  return "fill";
}

/**
 * Global, persisted grid view mode: "fill" (cover, edge-to-edge), "fit"
 * (contain, letterboxed), or "card" (contained on a padded surface). Persisted
 * to localStorage so the choice carries across routes and reloads, and synced
 * across tabs via the `storage` event.
 */
export function useGridView() {
  const mode = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setMode = useCallback((next: GridViewMode) => {
    localStorage.setItem(STORAGE_KEY, next);
    listeners.forEach((cb) => cb());
  }, []);

  return { mode, setMode };
}
