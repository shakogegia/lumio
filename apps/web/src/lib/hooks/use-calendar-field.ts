"use client";

import { useCallback, useSyncExternalStore } from "react";
import { type CalendarField, coerceCalendarField, DEFAULT_CALENDAR_FIELD, parseCalendarMetaField } from "@lumio/shared";
import type { DateSortField } from "@/lib/grid-sort";

const STORAGE_KEY = "lumio:calendar-field";

export function parseCalendarFieldStored(stored: string | null): CalendarField {
  return coerceCalendarField(stored ?? undefined);
}

/** A stored metadata dimension whose field isn't in this catalog falls back to
 *  the default so the tabs + filter stay consistent. `undefined` fields = still
 *  loading → keep the stored value. */
export function effectiveCalendarField(field: CalendarField, fields: DateSortField[] | undefined): CalendarField {
  const id = parseCalendarMetaField(field);
  if (!id || !fields) return field;
  return fields.some((f) => f.id === id) ? field : DEFAULT_CALENDAR_FIELD;
}

// Same-document subscribers; the native `storage` event only fires in other tabs.
const listeners = new Set<() => void>();
function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener("storage", onChange);
  };
}
function getSnapshot(): CalendarField {
  return parseCalendarFieldStored(localStorage.getItem(STORAGE_KEY));
}
function getServerSnapshot(): CalendarField {
  return DEFAULT_CALENDAR_FIELD;
}

/** Global, persisted calendar date-dimension. Mirrors useGridSort. */
export function useCalendarField() {
  const field = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const setField = useCallback((next: CalendarField) => {
    localStorage.setItem(STORAGE_KEY, next);
    listeners.forEach((cb) => cb());
  }, []);
  return { field, setField };
}
