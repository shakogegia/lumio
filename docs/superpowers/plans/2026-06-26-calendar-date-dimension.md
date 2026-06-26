# Calendar date-dimension tabs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Add tabs to the toolbar calendar month-filter to choose which date dimension it operates on — **Taken** (sortDate) · **Imported** (createdAt) · **Created** (fileCreatedAt) · one per enabled **metadata Date field**. Both the month *filter* and the calendar's *facets* (counts + cover tiles) follow the selected tab.

**Architecture:** Mirror the metadata-Date *sort* feature. A `CalendarField` token (`taken | imported | created | meta:<fieldId>`) is threaded as a `dateField` query param. Standard dims map to a Photo column; a metadata dim goes through the `PhotoMetadataValue` child table (ISO `YYYY-MM` value range — index-backed). One `calendarWhere(field, month)` helper replaces the 5 hardcoded `where.sortDate = monthRange(month)` sites; `buildCalendarFacets` is generalized to bucket on the chosen dimension. The chosen dimension is a global persisted preference (`useCalendarField`, like `useGridSort`); `month` stays ephemeral. The lightbox neighbor scope does NOT carry month today, so no neighbor/detail changes.

**Tech Stack:** TypeScript monorepo (`@lumio/shared`, `@lumio/db`, `apps/web` Next.js), Prisma/Postgres, Zod, React, shadcn (Tabs available at `components/ui/tabs.tsx`), vitest.

**Backward compatible:** `DEFAULT_CALENDAR_FIELD = "taken"` (= sortDate); with no `dateField` param everything behaves exactly as today.

---

## Background (verified)

- Facets: `buildCalendarFacets(catalogId, where, db)` (`apps/web/src/lib/server/calendar-service.ts`) fetches `{id, sortDate}` newest-first and buckets by UTC year/month in JS; first id per (year,month) = cover. Shape `CalendarFacets` (`packages/shared/src/calendar.ts`): `{ years: [{ year, count, months: [{ month, count, coverId }] }] }`.
- 5 filter sites all apply `{ sortDate: monthRange(month) }`: `listPhotos` (`photos-service.ts`), `listAlbumPhotos` (`albums-service.ts`), `searchInnerWhere` + `searchWhere` (`search-service.ts`), and the `fs/photos` route.
- 5 facets routes call `buildCalendarFacets(catalog.id, where, db)`: `photos/calendar`, `albums/[id]/calendar`, `fs/calendar`, `search/calendar` (favorites reuses photos/calendar with `?favorite=true`).
- `monthRange(month)` → `{ gte: Date, lt: Date }` UTC half-open (`packages/shared/src/calendar.ts`).
- Menu: `GridCalendarMenu` (`apps/web/src/components/grid-calendar-menu.tsx`) props `{ facetsEndpoint, value, onChange }`, fetches facets lazily on open (effect deps `[open, facetsEndpoint]`).
- `month` state lives in `PhotoLibraryView` (`useState`) — host for library/favorites/album/folders — and in `search-view.tsx`. Each builds a `collection({ sort, month })` → list params, and renders `<GridCalendarMenu>`.
- `useDateSortFields()` (`apps/web/src/lib/hooks/use-date-sort-fields.ts`) already returns the feature-gated enabled Date fields (`{id,label}[] | undefined`).
- Metadata date values are ISO `YYYY-MM-DD` text in `PhotoMetadataValue.value`, indexed `@@index([fieldId, value])`.

---

## Task 1: Shared — `CalendarField` encoding + schema

**Files:** Modify `packages/shared/src/calendar.ts`, `packages/shared/src/api.ts`; Test `packages/shared/src/calendar.test.ts` (create or extend).

- [ ] **Step 1: Failing test** — create `packages/shared/src/calendar.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  CALENDAR_FIELDS,
  calendarColumn,
  coerceCalendarField,
  DEFAULT_CALENDAR_FIELD,
  isCalendarField,
  monthStringRange,
  parseCalendarMetaField,
} from "./calendar.js";

describe("CalendarField", () => {
  it("maps standard fields to Photo columns", () => {
    expect(calendarColumn("taken")).toBe("sortDate");
    expect(calendarColumn("imported")).toBe("createdAt");
    expect(calendarColumn("created")).toBe("fileCreatedAt");
  });
  it("parses metadata field tokens", () => {
    expect(parseCalendarMetaField("meta:clx1")).toBe("clx1");
    expect(parseCalendarMetaField("taken")).toBeNull();
    expect(parseCalendarMetaField("meta:")).toBeNull();
  });
  it("validates with isCalendarField", () => {
    expect(isCalendarField("taken")).toBe(true);
    expect(isCalendarField("meta:clx1")).toBe(true);
    expect(isCalendarField("meta:clx1:asc")).toBe(false);
    expect(isCalendarField("nope")).toBe(false);
    expect(isCalendarField(7)).toBe(false);
  });
  it("coerces unknown input to the default", () => {
    expect(coerceCalendarField("imported")).toBe("imported");
    expect(coerceCalendarField("meta:clx1")).toBe("meta:clx1");
    expect(coerceCalendarField("junk")).toBe(DEFAULT_CALENDAR_FIELD);
    expect(coerceCalendarField(null)).toBe(DEFAULT_CALENDAR_FIELD);
    expect(DEFAULT_CALENDAR_FIELD).toBe("taken");
    expect(CALENDAR_FIELDS).toEqual(["taken", "imported", "created"]);
  });
  it("monthStringRange gives ISO text bounds, rolling December", () => {
    expect(monthStringRange("2024-06")).toEqual({ gte: "2024-06-01", lt: "2024-07-01" });
    expect(monthStringRange("2024-12")).toEqual({ gte: "2024-12-01", lt: "2025-01-01" });
  });
});
```

- [ ] **Step 2:** `pnpm --filter @lumio/shared test -- calendar` → FAIL (exports missing).

- [ ] **Step 3:** Append to `packages/shared/src/calendar.ts`:

```ts
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
```

- [ ] **Step 4:** In `packages/shared/src/api.ts`, add a schema near `monthParamSchema`:

```ts
/** Which date dimension the calendar month-filter uses. */
export const calendarFieldSchema = z.custom<CalendarField>((v) => isCalendarField(v), {
  message: "invalid date field",
});
```

Import `isCalendarField` and the `CalendarField` type from `./calendar.js` at the top of `api.ts`. Then add `dateField: calendarFieldSchema.optional()` to BOTH `photosQuerySchema` and `searchQuerySchema` (alongside the existing `month`).

- [ ] **Step 5:** `pnpm --filter @lumio/shared test -- calendar` → PASS; `pnpm --filter @lumio/shared build` clean.

- [ ] **Step 6:** Commit `feat(shared): CalendarField date-dimension encoding for the calendar filter`.

---

## Task 2: Server — `calendarWhere` + dimension-aware facets

**Files:** Create `apps/web/src/lib/server/calendar-where.ts`; Modify `apps/web/src/lib/server/calendar-service.ts`; Test both (`calendar-where.test.ts`, extend `calendar-service.test.ts`).

- [ ] **Step 1: Failing test** — create `apps/web/src/lib/server/calendar-where.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { calendarWhere } from "./calendar-where.js";

describe("calendarWhere", () => {
  it("filters a standard dimension on its column", () => {
    expect(calendarWhere("taken", "2024-06")).toMatchObject({ sortDate: { gte: expect.any(Date), lt: expect.any(Date) } });
    expect(calendarWhere("imported", "2024-06")).toHaveProperty("createdAt");
    expect(calendarWhere("created", "2024-06")).toHaveProperty("fileCreatedAt");
  });
  it("filters a metadata dimension via the child table with an ISO value range", () => {
    expect(calendarWhere("meta:clx1", "2024-12")).toEqual({
      metadataValues: { some: { fieldId: "clx1", value: { gte: "2024-12-01", lt: "2025-01-01" } } },
    });
  });
});
```

- [ ] **Step 2:** `pnpm --filter @lumio/web test -- calendar-where` → FAIL.

- [ ] **Step 3:** Create `apps/web/src/lib/server/calendar-where.ts`:

```ts
import type { Prisma } from "@lumio/db";
import {
  type CalendarField,
  calendarColumn,
  monthRange,
  monthStringRange,
  parseCalendarMetaField,
} from "@lumio/shared";

/**
 * The month-filter `where` clause for a date dimension. Standard dimensions
 * filter their Photo column with a UTC Date range; a metadata dimension filters
 * the child table with an ISO `YYYY-MM-DD` text range (index-backed on value).
 */
export function calendarWhere(field: CalendarField, month: string): Prisma.PhotoWhereInput {
  const fieldId = parseCalendarMetaField(field);
  if (fieldId) {
    const { gte, lt } = monthStringRange(month);
    return { metadataValues: { some: { fieldId, value: { gte, lt } } } };
  }
  return { [calendarColumn(field)]: monthRange(month) } as Prisma.PhotoWhereInput;
}
```

- [ ] **Step 4:** Generalize `buildCalendarFacets` in `apps/web/src/lib/server/calendar-service.ts`. New signature `buildCalendarFacets(catalogId, where, field: CalendarField, db)`. Widen `Db` to `Pick<PrismaClient, "photo" | "photoMetadataValue">`. Replace the body so it builds a newest-first list of `{ year, month, id }` entries — from the chosen Photo column for a standard dimension, or from `photoMetadataValue` rows for a metadata dimension — then runs the existing year/month accumulation. Full replacement:

```ts
import { type Prisma, type PrismaClient, prisma } from "@lumio/db";
import { type CalendarField, calendarColumn, type CalendarFacets, type CalendarMonthFacet, parseCalendarMetaField } from "@lumio/shared";
import { LIVE_PHOTO } from "@/lib/server/photo-filters";

type Db = Pick<PrismaClient, "photo" | "photoMetadataValue">;

interface YearAcc {
  year: number;
  count: number;
  months: Map<number, CalendarMonthFacet>;
}

interface Entry {
  year: number;
  month: number; // 1–12
  id: string;
}

/** Newest-first (year, month, photoId) entries from a standard Photo column. */
async function columnEntries(field: CalendarField, where: Prisma.PhotoWhereInput, db: Db): Promise<Entry[]> {
  const col = calendarColumn(field);
  const rows = await db.photo.findMany({
    where,
    select: { id: true, sortDate: true, createdAt: true, fileCreatedAt: true },
    orderBy: [{ [col]: "desc" }, { id: "desc" }] as Prisma.PhotoOrderByWithRelationInput[],
  });
  const out: Entry[] = [];
  for (const r of rows) {
    const d = r[col];
    if (!d) continue; // fileCreatedAt may be null
    out.push({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, id: r.id });
  }
  return out;
}

/** Newest-first entries from a metadata Date field's ISO `YYYY-MM-DD` values. */
async function metaEntries(fieldId: string, where: Prisma.PhotoWhereInput, db: Db): Promise<Entry[]> {
  const rows = await db.photoMetadataValue.findMany({
    where: { fieldId, photo: where },
    select: { photoId: true, value: true },
    orderBy: [{ value: "desc" }, { photoId: "desc" }],
  });
  const out: Entry[] = [];
  for (const { photoId, value } of rows) {
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(5, 7));
    if (!Number.isInteger(year) || month < 1 || month > 12) continue; // skip non-ISO
    out.push({ year, month, id: photoId });
  }
  return out;
}

/**
 * Year → month facet tree for a navigation scope (`where`) on the chosen date
 * dimension (`field`). Standard dimensions bucket a Photo column; a metadata
 * dimension buckets the field's ISO values. Entries arrive newest-first so the
 * first id per (year, month) is that month's cover. UTC, deterministic.
 * `catalogId` + the live filter are ANDed with the caller `where`.
 */
export async function buildCalendarFacets(
  catalogId: string,
  where: Prisma.PhotoWhereInput,
  field: CalendarField,
  db: Db = prisma,
): Promise<CalendarFacets> {
  const scopedWhere: Prisma.PhotoWhereInput = { catalogId, ...LIVE_PHOTO, ...where };
  const metaFieldId = parseCalendarMetaField(field);
  const entries = metaFieldId
    ? await metaEntries(metaFieldId, scopedWhere, db)
    : await columnEntries(field, scopedWhere, db);

  const years = new Map<number, YearAcc>();
  for (const { year, month, id } of entries) {
    let acc = years.get(year);
    if (!acc) years.set(year, (acc = { year, count: 0, months: new Map() }));
    acc.count += 1;
    const existing = acc.months.get(month);
    if (existing) existing.count += 1;
    else acc.months.set(month, { month, count: 1, coverId: id });
  }

  return {
    years: [...years.values()]
      .sort((a, b) => b.year - a.year)
      .map((y) => ({ year: y.year, count: y.count, months: [...y.months.values()].sort((a, b) => b.month - a.month) })),
  };
}
```

- [ ] **Step 5: Add a facets test** — extend `apps/web/src/lib/server/calendar-service.test.ts` (match its existing fake-db style) with: (a) a standard `imported` dimension buckets on `createdAt` (assert the `orderBy` uses createdAt and a row's createdAt month lands in the right bucket); (b) a `meta:clx1` dimension reads `photoMetadataValue` (fake returns `[{photoId:"p1",value:"2024-06-15"},{photoId:"p2",value:"2024-06-02"}]`) → one year 2024, month 6, count 2, coverId "p1". If no existing test file, create one with a minimal fake db exposing `photo.findMany` and `photoMetadataValue.findMany`.

- [ ] **Step 6:** `pnpm --filter @lumio/web test -- calendar-where calendar-service` PASS; `pnpm --filter @lumio/web exec tsc --noEmit 2>&1 | grep -iE "calendar"` empty.

- [ ] **Step 7:** Commit `feat(web): calendarWhere + dimension-aware buildCalendarFacets`.

---

## Task 3: Server — apply the dimension at the 5 filter sites + 5 facets routes

**Files:** Modify `photos-service.ts`, `albums-service.ts`, `search-service.ts`, the `fs/photos` route, and the 5 calendar routes. Test: extend existing service tests.

- [ ] **Step 1:** Thread `dateField` into the list filters. In each site, read the dimension from params (default `DEFAULT_CALENDAR_FIELD`) and replace `{ sortDate: monthRange(month) }` with `calendarWhere(field, month)`:
  - `photos-service.ts` `listPhotos`: `if (month) Object.assign(where, calendarWhere(params.dateField ?? DEFAULT_CALENDAR_FIELD, month));` (replace the `where.sortDate = monthRange(month)` line). `PhotosQuery` already gains `dateField` from Task 1.
  - `albums-service.ts` `listAlbumPhotos` (~line 216): `month ? { AND: [scoped, calendarWhere(params.dateField ?? DEFAULT_CALENDAR_FIELD, month)] } : scoped`.
  - `search-service.ts` `searchInnerWhere` (~25) and `searchWhere` (~38): `{ AND: [base, calendarWhere(params.dateField ?? DEFAULT_CALENDAR_FIELD, params.month)] }`.
  - `fs/photos` route (`apps/web/src/app/api/c/[catalog]/fs/photos/route.ts`): parse `const dateField = coerceCalendarField(searchParams.get("dateField") ?? undefined);` and `if (month.success) Object.assign(where, calendarWhere(dateField, month.data));`.
  Import `calendarWhere` from `@/lib/server/calendar-where` and `DEFAULT_CALENDAR_FIELD`/`coerceCalendarField` from `@lumio/shared` in each touched file.

- [ ] **Step 2:** Pass `dateField` to facets in the 5 routes. Each calendar route parses `const dateField = coerceCalendarField(new URL(request.url).searchParams.get("dateField") ?? undefined);` and calls `buildCalendarFacets(catalog.id, where, dateField, db)`:
  - `apps/web/src/app/api/c/[catalog]/photos/calendar/route.ts`
  - `apps/web/src/app/api/c/[catalog]/albums/[id]/calendar/route.ts`
  - `apps/web/src/app/api/c/[catalog]/fs/calendar/route.ts`
  - `apps/web/src/app/api/c/[catalog]/search/calendar/route.ts`
  (favorites reuses photos/calendar.) Read each route first to match its exact param-parsing style.

- [ ] **Step 3:** Update tests that assert the month `where`. Where existing service tests assert `{ sortDate: monthRange(...) }` for a month filter, confirm they still pass with the default dimension (`taken` → sortDate, identical). Add at least one test: `listPhotos` with `dateField: "imported"` + a month applies `createdAt` range (not sortDate); and `dateField: "meta:clx1"` applies the `metadataValues.some` clause. (Use the existing fake-db pattern; assert the `where` passed to `findMany`/`count`.)

- [ ] **Step 4:** `pnpm --filter @lumio/web test` (full) PASS; `pnpm --filter @lumio/web exec tsc --noEmit` clean.

- [ ] **Step 5:** Commit `feat(web): apply the chosen date dimension to the month filter + facets`.

---

## Task 4: Client — dimension state + tabs in the calendar menu

**Files:** Create `apps/web/src/lib/hooks/use-calendar-field.ts`; Modify `apps/web/src/components/grid-calendar-menu.tsx`; Test `apps/web/src/lib/hooks/use-calendar-field.test.ts` (pure helpers).

- [ ] **Step 1: Failing test** — create `use-calendar-field.test.ts` for the pure helpers `parseCalendarFieldStored` and `effectiveCalendarField`:

```ts
import { describe, expect, it } from "vitest";
import { effectiveCalendarField, parseCalendarFieldStored } from "./use-calendar-field";

describe("parseCalendarFieldStored", () => {
  it("coerces stored values, defaulting on junk", () => {
    expect(parseCalendarFieldStored("imported")).toBe("imported");
    expect(parseCalendarFieldStored("meta:clx1")).toBe("meta:clx1");
    expect(parseCalendarFieldStored(null)).toBe("taken");
  });
});

describe("effectiveCalendarField", () => {
  const fields = [{ id: "clx1", label: "Shoot" }];
  it("keeps a standard field", () => {
    expect(effectiveCalendarField("imported", fields)).toBe("imported");
  });
  it("keeps a present metadata field", () => {
    expect(effectiveCalendarField("meta:clx1", fields)).toBe("meta:clx1");
  });
  it("falls back when the metadata field is absent", () => {
    expect(effectiveCalendarField("meta:gone", fields)).toBe("taken");
  });
  it("leaves the field untouched while fields load (undefined)", () => {
    expect(effectiveCalendarField("meta:gone", undefined)).toBe("meta:gone");
  });
});
```

- [ ] **Step 2:** `pnpm --filter @lumio/web test -- use-calendar-field` → FAIL.

- [ ] **Step 3:** Create `apps/web/src/lib/hooks/use-calendar-field.ts` — mirror `use-grid-sort.ts` (useSyncExternalStore over localStorage key `lumio:calendar-field`), plus the two pure helpers:

```ts
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

const listeners = new Set<() => void>();
function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener("storage", onChange);
  return () => { listeners.delete(onChange); window.removeEventListener("storage", onChange); };
}
function getSnapshot(): CalendarField {
  return parseCalendarFieldStored(localStorage.getItem(STORAGE_KEY));
}
function getServerSnapshot(): CalendarField {
  return DEFAULT_CALENDAR_FIELD;
}

/** Global, persisted calendar date-dimension. */
export function useCalendarField() {
  const field = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const setField = useCallback((next: CalendarField) => {
    localStorage.setItem(STORAGE_KEY, next);
    listeners.forEach((cb) => cb());
  }, []);
  return { field, setField };
}
```

- [ ] **Step 4:** `GridCalendarMenu` — add props `field: CalendarField; onFieldChange: (f: CalendarField) => void; dateFields: DateSortField[]`. (a) Render a tab row at the top of the popover content using the shadcn `Tabs`/`TabsList`/`TabsTrigger` (`@/components/ui/tabs`), value=`field`, `onValueChange={(v) => onFieldChange(v as CalendarField)}`, with triggers: `taken`→"Taken", `imported`→"Imported", `created`→"Created", then one per `dateFields` (value `metaCalendarField(f.id)`, label `f.label`). Wrap the `TabsList` in a horizontally scrollable container (`className="overflow-x-auto"`) so many metadata fields don't overflow. Place it above the years/months panes (inside `PopoverContent`, before the `loading/error/...` block). (b) Append the dimension to the facets fetch URL: `const url = facetsEndpoint + (facetsEndpoint.includes("?") ? "&" : "?") + "dateField=" + encodeURIComponent(field);` and fetch `url`. (c) Add `field` to the effect deps (`[open, facetsEndpoint, field]`) so switching tabs refetches facets. Keep the existing year-seeding logic.

- [ ] **Step 5:** `pnpm --filter @lumio/web test -- use-calendar-field` PASS; `pnpm --filter @lumio/web exec tsc --noEmit` clean; `pnpm --filter @lumio/web lint` no new errors in the two files.

- [ ] **Step 6:** Commit `feat(web): date-dimension tabs + persisted field in the calendar menu`.

---

## Task 5: Client — thread the dimension through the views

**Files:** Modify `apps/web/src/components/photo-library/photo-library-view.tsx`, the 4 collection builders (`photos/library-view.tsx`, `favorites/favorites-view.tsx`, `albums/[id]/album-view.tsx`, `folders/folder-explorer.tsx`), and `search/search-view.tsx`.

- [ ] **Step 1:** `PhotoLibraryView`: add `const { field: storedField, setField } = useCalendarField();` and `const calField = effectiveCalendarField(storedField, dateFields);` (`dateFields` already comes from `useDateSortFields()`). Extend the `collection` callback type to `(args: { sort: PhotoSort; month: string | null; field: CalendarField }) => PhotoCollectionSource` and call `collection({ sort, month, field: calField })`. Pass to the menu: `<GridCalendarMenu facetsEndpoint=... value={month} onChange={setMonth} field={calField} onFieldChange={setField} dateFields={dateFields ?? []} />`. (The collection `key` must include `field` so the grid remounts when the dimension changes while a month is active — fold `field` into `src.key` at each builder, see Step 2.)

- [ ] **Step 2:** Each of the 4 collection builders: accept `field` and, when `month` is set, add `dateField` to the list params and include `field` in the `key`. Example (`library-view.tsx`):

```tsx
collection={({ sort, month, field }) => {
  const params = new URLSearchParams(month ? { sort, month, dateField: field } : { sort });
  return { endpoint: catalogApiUrl(slug, "/photos"), params, urlForId, baseUrl, key: `${sort}:${month ?? ""}:${field}` };
}}
```

Apply the analogous change to `favorites-view.tsx` (keep `favorite: "true"`), `album-view.tsx`, and `folder-explorer.tsx` (keep `path`). Read each builder first to match its exact param/key construction. `dateField` is only added when `month` is set (it only scopes the month filter); `field` is always in the `key`.

- [ ] **Step 3:** `search-view.tsx`: add `const { field: storedField, setField } = useCalendarField();` + `const calField = effectiveCalendarField(storedField, dateFields);`. When building list params, add `if (month) p.set("dateField", calField);`. Add `calField` to the grid `key` (`${serialized}:${sort}:${month ?? ""}:${calField}`). Pass `field={calField} onFieldChange={setField} dateFields={dateFields ?? []}` to its `<GridCalendarMenu>`. (The search facets endpoint gets `dateField` appended by the menu, as in Task 4.)

- [ ] **Step 4:** `pnpm --filter @lumio/web exec tsc --noEmit` clean; `pnpm --filter @lumio/web lint` no new errors in touched files; `pnpm --filter @lumio/web test` (full) PASS.

- [ ] **Step 5:** Commit `feat(web): offer Taken/Imported/Created + metadata-date calendar filtering in all grids`.

---

## Task 6: Verification

- [ ] **Step 1:** Full suite: `pnpm --filter @lumio/shared test && pnpm --filter @lumio/web test && pnpm --filter @lumio/web exec tsc --noEmit && pnpm --filter @lumio/web lint`.

- [ ] **Step 2: Browser smoke** — open a catalog with a metadata Date field that has values. In the toolbar calendar: (1) tabs Taken/Imported/Created + the metadata field appear (metadata tab only when the Metadata feature is on); (2) switching tabs recomputes the month counts + cover tiles; (3) picking a month filters the grid on that dimension; (4) the metadata tab buckets/filters by the field's dates; (5) the choice persists across views; (6) a catalog without that field shows only the three standard tabs and doesn't error. Check library, favorites, album, folder, and search.

---

## Notes
- No migration, no lightbox/neighbor changes (month is grid-only; the detail scope doesn't carry it).
- `DEFAULT_CALENDAR_FIELD = "taken"` keeps every existing URL/behaviour identical when `dateField` is absent.
- Metadata month range uses an ISO text `gte/lt` on `value` (index-backed via `@@index([fieldId, value])`); `startsWith` was avoided because prefix-LIKE may not use the btree under the default collation.
