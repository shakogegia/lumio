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
