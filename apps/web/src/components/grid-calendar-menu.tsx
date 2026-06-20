"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Loader2 } from "lucide-react";
import type { CalendarFacets } from "@lumio/shared";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Format a `YYYY-MM` value for the active trigger label, e.g. "Jun 2026". */
function formatMonth(value: string): string {
  const [y, m] = value.split("-").map(Number);
  return `${MONTH_ABBR[m - 1]} ${y}`;
}

/**
 * Toolbar control to filter the grid by calendar month. The trigger is a calendar
 * icon — when a month is active it also shows the month label. The flyout is a
 * two-pane picker: years on the left, that year's month cover tiles on the right.
 * Facets are fetched lazily on open from `facetsEndpoint` (the scope's calendar
 * route), so they always reflect the current scope. Picking a tile calls
 * `onChange("YYYY-MM")`; "All photos" calls `onChange(null)`.
 */
export function GridCalendarMenu({
  facetsEndpoint,
  value,
  onChange,
}: {
  facetsEndpoint: string;
  value: string | null;
  onChange: (month: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [facets, setFacets] = useState<CalendarFacets | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  // Which year's months are shown in the right pane.
  const [activeYear, setActiveYear] = useState<number | null>(null);

  const selected = useMemo(() => {
    if (!value) return null;
    const [year, month] = value.split("-").map(Number);
    return { year, month };
  }, [value]);

  // Fetch facets when the popover opens (or its scope endpoint changes while open).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(false);
    fetch(facetsEndpoint)
      .then((res) => (res.ok ? (res.json() as Promise<CalendarFacets>) : Promise.reject(new Error())))
      .then((data) => {
        if (cancelled) return;
        setFacets(data);
        // Default the visible year to the active month's year when that year
        // exists in this scope, else the newest — so the month pane is never empty.
        const fallbackYear = data.years[0]?.year ?? null;
        setActiveYear(
          selected && data.years.some((y) => y.year === selected.year)
            ? selected.year
            : fallbackYear,
        );
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // `selected` is read only at open time to seed the default year — excluding it
    // keeps the fetch from re-running when the parent's value changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, facetsEndpoint]);

  const year = facets?.years.find((y) => y.year === activeYear) ?? null;

  function pick(y: number, m: number) {
    onChange(`${y}-${String(m).padStart(2, "0")}`);
    setOpen(false);
  }

  function clear() {
    onChange(null);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size={value ? "sm" : "icon-sm"}
          aria-label="Filter by month"
          title="Filter by month"
          aria-pressed={value != null}
        >
          <CalendarDays aria-hidden />
          {value && <span>{formatMonth(value)}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[22rem] overflow-hidden p-0">
        {loading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
          </div>
        ) : error ? (
          <div className="flex h-48 flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground">
            <span>Couldn&apos;t load dates.</span>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>
        ) : !facets || facets.years.length === 0 ? (
          <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
            No photos to filter.
          </div>
        ) : (
          <div className="relative">
            {/* The popover height follows the month grid, so its padding stays
                symmetric regardless of how many months a year has and the months
                never scroll (a year is at most 12 = 4 rows). The years list is
                taken out of flow (absolute) so it fills that same height and
                scrolls on its own when there are more years than fit. */}
            {/* Years (+ an All-photos reset) — scrolls when there are many years */}
            <ul className="absolute inset-y-0 left-0 w-24 overflow-y-auto border-r py-1">
              <li>
                <button
                  type="button"
                  onClick={clear}
                  className={cn(
                    "w-full px-3 py-1.5 text-left text-sm hover:bg-accent",
                    value ? "text-muted-foreground" : "font-medium text-foreground",
                  )}
                >
                  All photos
                </button>
              </li>
              {facets.years.map((y) => (
                <li key={y.year}>
                  <button
                    type="button"
                    onClick={() => setActiveYear(y.year)}
                    className={cn(
                      "w-full px-3 py-1.5 text-left text-sm hover:bg-accent",
                      y.year === activeYear ? "bg-accent font-medium" : "text-muted-foreground",
                    )}
                  >
                    {y.year}
                  </button>
                </li>
              ))}
            </ul>
            {/* All 12 months (Jan–Dec) are always rendered, so the grid is a fixed
                four rows: this drives a stable pane height with symmetric padding
                and the months never scroll. Months with no photos in this scope are
                non-interactive placeholders. `ml-24` clears the absolutely-
                positioned years column. */}
            {year && (
              <div className="ml-24 grid auto-rows-min grid-cols-3 gap-2 p-2">
                {MONTH_ABBR.map((label, i) => {
                  const monthNum = i + 1;
                  const m = year.months.find((mm) => mm.month === monthNum);
                  if (!m) {
                    return (
                      <div
                        key={monthNum}
                        className="flex aspect-square items-end rounded-md bg-muted/40 p-1.5 text-xs font-medium text-muted-foreground/50"
                      >
                        {label}
                      </div>
                    );
                  }
                  const active = selected?.year === year.year && selected.month === monthNum;
                  return (
                    <button
                      key={monthNum}
                      type="button"
                      onClick={() => pick(year.year, monthNum)}
                      title={`${label} ${year.year} · ${m.count}`}
                      className={cn(
                        "group relative aspect-square overflow-hidden rounded-md ring-offset-background",
                        active && "ring-2 ring-ring ring-offset-2",
                      )}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/photos/${m.coverId}/display`}
                        alt=""
                        className="size-full object-cover transition group-hover:scale-105"
                      />
                      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-1.5 py-1 text-left text-xs font-medium text-white">
                        {label}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
