/**
 * Calendar facet tree for the month-filter flyout. Months are grouped by a
 * photo's `sortDate` (takenAt ?? import time), bucketed by UTC.
 */
export interface CalendarMonthFacet {
  /** Calendar month, 1–12. */
  month: number;
  /** Photos in this month within the current scope. */
  count: number;
  /** Newest photo in the month (sortDate desc) — the month tile's cover. */
  coverId: string;
}

export interface CalendarYearFacet {
  year: number;
  /** Total photos in the year (sum of its months). */
  count: number;
  /** Months that have photos, descending. */
  months: CalendarMonthFacet[];
}

export interface CalendarFacets {
  /** Years that have photos, descending. */
  years: CalendarYearFacet[];
}

/**
 * UTC [gte, lt) range for a `YYYY-MM` month, rolling December into next January.
 * The caller must pass a month already validated by `monthParamSchema`.
 */
export function monthRange(month: string): { gte: Date; lt: Date } {
  // monthParamSchema guarantees a valid `YYYY-MM`, so the split yields exactly two numbers.
  const [y, m] = month.split("-").map(Number) as [number, number]; // m is 1–12
  return {
    gte: new Date(Date.UTC(y, m - 1, 1)),
    lt: new Date(Date.UTC(y, m, 1)), // m === 12 → Date.UTC(y, 12, 1) is next-year Jan 1
  };
}

/** The standard (Photo-column) calendar dimensions. */
export const CALENDAR_FIELDS = ["taken", "imported", "created"] as const;

/** Which date dimension the calendar month-filter operates on: a standard
 *  Photo-column dimension, or a custom metadata Date field (`meta:<fieldId>`). */
export type CalendarField = (typeof CALENDAR_FIELDS)[number] | `meta:${string}`;

/** Default dimension: capture date (sortDate) — the historical behaviour. */
export const DEFAULT_CALENDAR_FIELD: CalendarField = "taken";

const CALENDAR_META_RE = /^meta:([a-z0-9]+)$/;

/** The Photo column a standard dimension buckets/filters on. */
export function calendarColumn(field: CalendarField): "sortDate" | "createdAt" | "fileCreatedAt" {
  return field === "imported" ? "createdAt" : field === "created" ? "fileCreatedAt" : "sortDate";
}

/** Field id for a `meta:<fieldId>` dimension, else null (a standard dimension). */
export function parseCalendarMetaField(field: string | undefined): string | null {
  const m = field ? CALENDAR_META_RE.exec(field) : null;
  return m ? m[1]! : null;
}

/** Token builder for a metadata dimension. */
export function metaCalendarField(fieldId: string): CalendarField {
  return `meta:${fieldId}`;
}

export function isCalendarField(value: unknown): value is CalendarField {
  return (
    (typeof value === "string" && CALENDAR_META_RE.test(value)) ||
    (CALENDAR_FIELDS as readonly unknown[]).includes(value)
  );
}

/** Lenient coercion (never throws) for query params + localStorage. */
export function coerceCalendarField(value: unknown): CalendarField {
  return isCalendarField(value) ? value : DEFAULT_CALENDAR_FIELD;
}

/** ISO text [gte, lt) month bounds for a `YYYY-MM`, e.g. {"2024-06-01","2024-07-01"}.
 *  Used to range-filter ISO `YYYY-MM-DD` metadata values (index-backed). */
export function monthStringRange(month: string): { gte: string; lt: string } {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
  return { gte: `${month}-01`, lt: `${next}-01` };
}
