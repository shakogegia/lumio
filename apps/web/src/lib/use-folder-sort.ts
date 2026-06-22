"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { FolderSort, FolderSortDir, FolderSortField } from "@/lib/catalog-fs";

const STORAGE_KEY = "lumio:folders-sort";
const DEFAULT_SORT: FolderSort = { field: "name", dir: "asc" };

function isField(v: string): v is FolderSortField {
  return v === "name" || v === "date";
}
function isDir(v: string): v is FolderSortDir {
  return v === "asc" || v === "desc";
}

/** Parse the stored `field:dir` value; defaults to name/asc. Pure for testing. */
export function parseFolderSort(stored: string | null): FolderSort {
  if (!stored) return DEFAULT_SORT;
  const [field, dir] = stored.split(":");
  if (field && dir && isField(field) && isDir(dir)) return { field, dir };
  return DEFAULT_SORT;
}

/** Serialize a sort to its `field:dir` storage form. Pure for testing. */
export function serializeFolderSort(sort: FolderSort): string {
  return `${sort.field}:${sort.dir}`;
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

function getSnapshot(): FolderSort {
  return parseFolderSort(localStorage.getItem(STORAGE_KEY));
}

// Server (and first hydration pass) assume the default; the real value is read
// on the client after mount via useSyncExternalStore (no hydration mismatch).
function getServerSnapshot(): FolderSort {
  return DEFAULT_SORT;
}

/** Global, persisted disk-explorer sort (name/date, asc/desc). */
export function useFolderSort() {
  const sort = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setSort = useCallback((next: FolderSort) => {
    localStorage.setItem(STORAGE_KEY, serializeFolderSort(next));
    listeners.forEach((cb) => cb());
  }, []);

  return { sort, setSort };
}
