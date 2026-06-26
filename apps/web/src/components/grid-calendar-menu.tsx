"use client";

import { type ReactNode, useEffect, useMemo, useState } from "react";
import { CalendarDays } from "lucide-react";
import { type CalendarField, type CalendarFacets, metaCalendarField } from "@lumio/shared";
import type { DateSortField } from "@/lib/grid-sort";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { catalogApiUrl } from "@/lib/catalog-api";
import { useCatalog } from "@/components/providers/catalog-context";

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
  field,
  appliedField,
  onFieldChange,
  dateFields,
}: {
  facetsEndpoint: string;
  value: string | null;
  onChange: (month: string | null) => void;
  /** The tab currently being browsed (drives the facets shown). */
  field: CalendarField;
  /** The dimension the active month is actually applied under (drives the grid). */
  appliedField: CalendarField;
  onFieldChange: (f: CalendarField) => void;
  dateFields: DateSortField[];
}) {
  const { slug } = useCatalog();
  const [open, setOpen] = useState(false);
  const [facets, setFacets] = useState<CalendarFacets | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  // Which year's months are shown in the right pane.
  const [activeYear, setActiveYear] = useState<number | null>(null);

  // The applied month is highlighted only while browsing its own dimension's tab,
  // so a month applied under one date field doesn't look selected under another.
  const selected = useMemo(() => {
    if (!value || field !== appliedField) return null;
    const [year, month] = value.split("-").map(Number);
    return { year, month };
  }, [value, field, appliedField]);

  // Fetch facets when the popover opens (or its scope endpoint changes while open).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(false);
    const url = facetsEndpoint + (facetsEndpoint.includes("?") ? "&" : "?") + "dateField=" + encodeURIComponent(field);
    fetch(url)
      .then((res) => (res.ok ? (res.json() as Promise<CalendarFacets>) : Promise.reject(new Error(`${res.status} ${res.url}`))))
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
  }, [open, facetsEndpoint, field]);

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
    <Tooltip>
      <Popover open={open} onOpenChange={setOpen}>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size={value ? "sm" : "icon-sm"}
              aria-label="Filter by month"
              aria-pressed={value != null}
            >
              <CalendarDays aria-hidden />
              {value && <span>{formatMonth(value)}</span>}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
      <PopoverContent align="end" className="w-[22rem] overflow-hidden p-0">
        <div className="border-b p-1">
          {/* Switching tabs only changes which facets are browsed — it does NOT
              touch the grid. The dimension is committed to the grid (via onChange)
              only when a month tile is picked. */}
          <Tabs value={field} onValueChange={(v) => onFieldChange(v as CalendarField)}>
            <TabsList className="flex w-full justify-start overflow-x-auto">
              <TabsTrigger value="taken">Taken</TabsTrigger>
              <TabsTrigger value="imported">Imported</TabsTrigger>
              <TabsTrigger value="created">Created</TabsTrigger>
              {dateFields.map((f) => (
                <TabsTrigger key={f.id} value={metaCalendarField(f.id)}>{f.label}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
        {/* Skeleton only on the first load. A tab-switch (or reopen) refetch keeps
            the current month/year tiles visible and swaps them in place when the
            new dimension's facets arrive — no jarring full-flyout flash. */}
        {loading && !facets ? (
          <CalendarSkeleton />
        ) : error ? (
          <FlyoutMessage>
            <span>Couldn&apos;t load dates.</span>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              Close
            </Button>
          </FlyoutMessage>
        ) : !facets || facets.years.length === 0 ? (
          <FlyoutMessage>No photos to filter.</FlyoutMessage>
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
                        src={catalogApiUrl(slug, `/photos/${m.coverId}/display`)}
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
      <TooltipContent>Filter by month</TooltipContent>
    </Tooltip>
  );
}

/** Loading placeholder that mirrors the two-pane picker: a years column and a
 *  3-column grid of month-cover tiles, so the flyout doesn't jump on load. */
function CalendarSkeleton() {
  return (
    <div className="relative">
      <div className="absolute inset-y-0 left-0 w-24 space-y-2 border-r py-2 pl-3 pr-2">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-5 w-12" />
        ))}
      </div>
      <div className="ml-24 grid auto-rows-min grid-cols-3 gap-2 p-2">
        {Array.from({ length: 12 }, (_, i) => (
          <Skeleton key={i} className="aspect-square rounded-md" />
        ))}
      </div>
    </div>
  );
}

/** A centered empty/error message sized to the picker via an invisible tile grid,
 *  so the flyout keeps a constant height across loading / empty / error / picker. */
function FlyoutMessage({ children }: { children: ReactNode }) {
  return (
    <div className="relative">
      <div className="invisible ml-24 grid auto-rows-min grid-cols-3 gap-2 p-2" aria-hidden>
        {Array.from({ length: 12 }, (_, i) => (
          <div key={i} className="aspect-square" />
        ))}
      </div>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground">
        {children}
      </div>
    </div>
  );
}
