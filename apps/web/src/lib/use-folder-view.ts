"use client";

import { useCallback, useSyncExternalStore } from "react";

export type FolderViewMode = "grid" | "list";

const STORAGE_KEY = "lumio:folders-view";

/** Resolve the stored disk-explorer layout; defaults to "grid". Pure for testing. */
export function parseFolderView(stored: string | null): FolderViewMode {
  return stored === "list" ? "list" : "grid";
}

// Same-document subscribers — the native `storage` event only fires in *other*
// tabs, so we notify our own listeners after a local write to stay in sync.
const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}

function getSnapshot(): FolderViewMode {
  return parseFolderView(localStorage.getItem(STORAGE_KEY));
}

// Server (and first hydration pass) assume the default; the real value is read
// on the client after mount via useSyncExternalStore (no hydration mismatch).
function getServerSnapshot(): FolderViewMode {
  return "grid";
}

/**
 * Global, persisted disk-explorer layout: "grid" (tiles) or "list" (rows).
 * Stored in localStorage so the choice carries across routes/reloads and syncs
 * across tabs via the `storage` event.
 */
export function useFolderView() {
  const view = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setView = useCallback((next: FolderViewMode) => {
    localStorage.setItem(STORAGE_KEY, next);
    listeners.forEach((cb) => cb());
  }, []);

  return { view, setView };
}
