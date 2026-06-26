"use client";

import { useEffect, useState } from "react";

export interface ValueCount {
  value: string;
  count: number;
}

export function normalizeValues(data: unknown): ValueCount[] {
  const arr = (data as { values?: unknown })?.values;
  if (!Array.isArray(arr)) return [];
  return arr.filter(
    (v): v is ValueCount => !!v && typeof (v as ValueCount).value === "string" && typeof (v as ValueCount).count === "number",
  );
}

export function normalizeFields(data: unknown): string[] {
  const arr = (data as { fields?: unknown })?.fields;
  return Array.isArray(arr) ? arr.filter((f): f is string => typeof f === "string") : [];
}

/** Distinct values (+counts) for a field, loaded once per field key. [] until loaded/on error. */
export function useExifValues(field: string | null): ValueCount[] {
  const [values, setValues] = useState<ValueCount[]>([]);
  useEffect(() => {
    if (!field) return; // no field → keep the empty initial state (no synchronous setState in an effect)
    let cancelled = false;
    fetch(`/api/exif/values?field=${encodeURIComponent(field)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled) setValues(normalizeValues(d));
      })
      .catch(() => {
        if (!cancelled) setValues([]);
      });
    return () => {
      cancelled = true;
    };
  }, [field]);
  return values;
}

/** Distinct EXIF keys present in the library, loaded once. */
export function useExifFields(enabled: boolean): string[] {
  const [fields, setFields] = useState<string[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetch("/api/exif/fields")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled) setFields(normalizeFields(d));
      })
      .catch(() => {
        if (!cancelled) setFields([]);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return fields;
}
