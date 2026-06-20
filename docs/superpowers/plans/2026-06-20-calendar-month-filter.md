# Calendar Month-Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a calendar icon to the photo toolbar that opens a year/month flyout (cover thumbnail per month) and filters the grid to the chosen month, on the Library, Album, and Search views.

**Architecture:** Each view already resolves its photo set to a single `Prisma.PhotoWhereInput` (library `{}`, album `albumPhotoWhere`, search `buildSearchWhere`). A new `buildCalendarFacets(where)` service fetches `{id, sortDate}` rows newest-first and buckets them into a `years → months → {count, coverId}` tree on the server. The grid filter adds a `month=YYYY-MM` query param that AND-combines a UTC `sortDate` range into the scope `where`. A scope-agnostic `GridCalendarMenu` Popover renders the flyout and is wired into all three views.

**Tech Stack:** Next.js (App Router, Node runtime), Prisma/Postgres, Zod, React, shadcn (Popover/Button), Vitest, pnpm workspaces (`@lumio/shared`, `@lumio/db`, `@lumio/web`).

**Conventions to follow:**
- Group photos by `sortDate` (`takenAt ?? importTime`), bucketed by **UTC**.
- Reuse existing `where`-builders so facets never drift from the grid.
- TDD for all pure/service logic; browser-verify the flyout UI (matches the repo's pattern — services/helpers have `*.test.ts`, components do not).
- Run a single shared test file with: `pnpm --filter @lumio/shared test` (it runs with `TZ=UTC`).
- Run a single web test file with: `pnpm --filter @lumio/web test <path>`.

---

## File Structure

**Create:**
- `packages/shared/src/calendar.ts` — facet types + `monthRange` helper
- `packages/shared/src/calendar.test.ts` — `monthRange` tests
- `apps/web/src/lib/calendar-service.ts` — `buildCalendarFacets`
- `apps/web/src/lib/calendar-service.test.ts` — bucketing tests
- `apps/web/src/components/grid-calendar-menu.tsx` — the flyout
- `apps/web/src/app/api/photos/calendar/route.ts` — library facets
- `apps/web/src/app/api/albums/[id]/calendar/route.ts` — album facets
- `apps/web/src/app/api/search/calendar/route.ts` — search facets

**Modify:**
- `packages/shared/src/api.ts` — `monthParamSchema`; add `month` to `photosQuerySchema` + `searchQuerySchema`
- `packages/shared/src/api.test.ts` — `month` validation tests
- `packages/shared/src/index.ts` — export `./calendar.js`
- `apps/web/src/lib/photos-service.ts` + `.test.ts` — apply `month` in `listPhotos`
- `apps/web/src/lib/albums-service.ts` + `.test.ts` — apply `month` in `listAlbumPhotos`
- `apps/web/src/lib/search-service.ts` + `.test.ts` — apply `month` in `searchPhotos`/`countSearchPhotos`
- `apps/web/src/app/(app)/photos/library-view.tsx` — month state + menu + wiring
- `apps/web/src/app/(app)/albums/[id]/album-view.tsx` — month state + menu + wiring
- `apps/web/src/app/(app)/search/search-view.tsx` — month state + menu + wiring
- `apps/web/src/app/(app)/search/use-search-count.ts` — month-aware count

---

## Task 1: Shared — calendar types, `monthRange`, and `month` query param

**Files:**
- Create: `packages/shared/src/calendar.ts`
- Create: `packages/shared/src/calendar.test.ts`
- Modify: `packages/shared/src/api.ts`
- Modify: `packages/shared/src/api.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write the failing `monthRange` test**

Create `packages/shared/src/calendar.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { monthRange } from "./calendar.js";

describe("monthRange", () => {
  it("returns the UTC [gte, lt) bounds for a mid-year month", () => {
    const { gte, lt } = monthRange("2026-06");
    expect(gte.toISOString()).toBe("2026-06-01T00:00:00.000Z");
    expect(lt.toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });

  it("rolls December into the next January", () => {
    const { gte, lt } = monthRange("2026-12");
    expect(gte.toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(lt.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("ends February on March 1 (leap year)", () => {
    const { gte, lt } = monthRange("2024-02");
    expect(gte.toISOString()).toBe("2024-02-01T00:00:00.000Z");
    expect(lt.toISOString()).toBe("2024-03-01T00:00:00.000Z");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @lumio/shared test calendar`
Expected: FAIL — cannot find module `./calendar.js` / `monthRange` is not a function.

- [ ] **Step 3: Create `calendar.ts`**

Create `packages/shared/src/calendar.ts`:

```ts
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
  const [y, m] = month.split("-").map(Number); // m is 1–12
  return {
    gte: new Date(Date.UTC(y, m - 1, 1)),
    lt: new Date(Date.UTC(y, m, 1)), // m === 12 → Date.UTC(y, 12, 1) is next-year Jan 1
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @lumio/shared test calendar`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing `month` schema tests**

In `packages/shared/src/api.test.ts`, add this block at the end of the file (after the last `describe`):

```ts
describe("photosQuerySchema month", () => {
  it("accepts a valid YYYY-MM month", () => {
    expect(photosQuerySchema.parse({ month: "2026-06" }).month).toBe("2026-06");
  });

  it("leaves month undefined when absent", () => {
    expect(photosQuerySchema.parse({}).month).toBeUndefined();
  });

  it("rejects an out-of-range month", () => {
    expect(photosQuerySchema.safeParse({ month: "2026-13" }).success).toBe(false);
  });

  it("rejects a non-zero-padded month", () => {
    expect(photosQuerySchema.safeParse({ month: "2026-6" }).success).toBe(false);
  });

  it("accepts a valid month on searchQuerySchema too", () => {
    expect(searchQuerySchema.parse({ month: "2026-06" }).month).toBe("2026-06");
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `pnpm --filter @lumio/shared test api`
Expected: FAIL — `month` is not on the parsed result (currently undefined for the "accepts" case) / out-of-range value is accepted.

- [ ] **Step 7: Add `monthParamSchema` and the `month` field**

In `packages/shared/src/api.ts`, add after the `photoSortSchema` / `coercePhotoSort` block (just before `/** Query params for GET /api/photos. */`):

```ts
/** A `YYYY-MM` month filter (e.g. "2026-06"). Strict zero-padded month 01–12. */
export const monthParamSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "month must be in YYYY-MM form");
```

Then add `month: monthParamSchema.optional(),` to `photosQuerySchema`:

```ts
export const photosQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  sort: photoSortSchema.optional(),
  month: monthParamSchema.optional(),
});
```

And add the same line to `searchQuerySchema` (after its `sort` field):

```ts
  sort: photoSortSchema.optional(),
  month: monthParamSchema.optional(),
});
```

- [ ] **Step 8: Export the calendar module**

In `packages/shared/src/index.ts`, add after `export * from "./api.js";`:

```ts
export * from "./calendar.js";
```

- [ ] **Step 9: Run the shared tests to verify they pass**

Run: `pnpm --filter @lumio/shared test`
Expected: PASS (all shared tests, including the new `calendar` and `month` cases).

- [ ] **Step 10: Commit**

```bash
git add packages/shared/src/calendar.ts packages/shared/src/calendar.test.ts \
  packages/shared/src/api.ts packages/shared/src/api.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): calendar facet types, monthRange, and month query param"
```

---

## Task 2: `calendar-service` — server-side bucketing

**Files:**
- Create: `apps/web/src/lib/calendar-service.ts`
- Test: `apps/web/src/lib/calendar-service.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/calendar-service.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildCalendarFacets } from "./calendar-service.js";

// Rows are supplied newest-first (sortDate desc, id desc) — exactly the order the
// service requests from Prisma — because bucketing trusts that order for covers.
function fakeDb(rows: Array<{ id: string; sortDate: Date }>) {
  const calls: Array<{ where?: unknown; select?: unknown; orderBy?: unknown }> = [];
  return {
    calls,
    photo: {
      findMany: async (args: { where?: unknown; select?: unknown; orderBy?: unknown }) => {
        calls.push(args);
        return rows;
      },
    },
  };
}

const d = (iso: string) => new Date(iso);

describe("buildCalendarFacets", () => {
  it("queries minimal rows newest-first scoped by the where", async () => {
    const db = fakeDb([]);
    await buildCalendarFacets({ albums: { some: { albumId: "a" } } }, db as never);
    expect(db.calls[0]?.where).toEqual({ albums: { some: { albumId: "a" } } });
    expect(db.calls[0]?.select).toEqual({ id: true, sortDate: true });
    expect(db.calls[0]?.orderBy).toEqual([{ sortDate: "desc" }, { id: "desc" }]);
  });

  it("buckets photos into descending years and months with counts", async () => {
    const db = fakeDb([
      { id: "p5", sortDate: d("2026-06-20T00:00:00.000Z") },
      { id: "p4", sortDate: d("2026-06-01T00:00:00.000Z") },
      { id: "p3", sortDate: d("2026-01-15T00:00:00.000Z") },
      { id: "p2", sortDate: d("2025-12-31T00:00:00.000Z") },
      { id: "p1", sortDate: d("2025-12-01T00:00:00.000Z") },
    ]);
    const facets = await buildCalendarFacets({}, db as never);
    expect(facets.years.map((y) => y.year)).toEqual([2026, 2025]);
    expect(facets.years[0]).toEqual({
      year: 2026,
      count: 3,
      months: [
        { month: 6, count: 2, coverId: "p5" },
        { month: 1, count: 1, coverId: "p3" },
      ],
    });
    expect(facets.years[1]).toEqual({
      year: 2025,
      count: 2,
      months: [{ month: 12, count: 2, coverId: "p2" }],
    });
  });

  it("uses the newest photo in a month as its cover", async () => {
    const db = fakeDb([
      { id: "newest", sortDate: d("2026-03-28T00:00:00.000Z") },
      { id: "older", sortDate: d("2026-03-02T00:00:00.000Z") },
    ]);
    const facets = await buildCalendarFacets({}, db as never);
    expect(facets.years[0]?.months[0]?.coverId).toBe("newest");
  });

  it("buckets by UTC month boundaries", async () => {
    const db = fakeDb([{ id: "p", sortDate: d("2026-06-30T23:30:00.000Z") }]);
    const facets = await buildCalendarFacets({}, db as never);
    expect(facets.years[0]?.year).toBe(2026);
    expect(facets.years[0]?.months[0]?.month).toBe(6);
  });

  it("returns no years for an empty scope", async () => {
    const facets = await buildCalendarFacets({}, fakeDb([]) as never);
    expect(facets.years).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @lumio/web test calendar-service`
Expected: FAIL — cannot find module `./calendar-service.js`.

- [ ] **Step 3: Implement `calendar-service.ts`**

Create `apps/web/src/lib/calendar-service.ts`:

```ts
import { type Prisma, type PrismaClient, prisma } from "@lumio/db";
import type { CalendarFacets, CalendarMonthFacet } from "@lumio/shared";

type Db = Pick<PrismaClient, "photo">;

interface YearAcc {
  year: number;
  count: number;
  months: Map<number, CalendarMonthFacet>;
}

/**
 * Build the year → month facet tree for a navigation scope (`where`), powering
 * the calendar month-filter flyout. Pulls the scope's photos as minimal
 * {id, sortDate} rows newest-first and buckets them in memory: the first id seen
 * for a (year, month) is that month's cover (it is the newest), and the running
 * tally is the count. Grouping is by `sortDate` (takenAt ?? import time) in UTC,
 * so results are deterministic regardless of server timezone.
 *
 * Scope-agnostic by design: callers pass the same `where` the list endpoints use
 * (library `{}`, album membership / smart-rule, search), so facets can never
 * drift from what the grid shows. Mirrors `getNeighborsForWhere`.
 */
export async function buildCalendarFacets(
  where: Prisma.PhotoWhereInput,
  db: Db = prisma,
): Promise<CalendarFacets> {
  const rows = await db.photo.findMany({
    where,
    select: { id: true, sortDate: true },
    orderBy: [{ sortDate: "desc" }, { id: "desc" }],
  });

  const years = new Map<number, YearAcc>();
  for (const { id, sortDate } of rows) {
    const year = sortDate.getUTCFullYear();
    const month = sortDate.getUTCMonth() + 1; // 1–12
    let acc = years.get(year);
    if (!acc) {
      acc = { year, count: 0, months: new Map() };
      years.set(year, acc);
    }
    acc.count += 1;
    const existing = acc.months.get(month);
    if (existing) {
      existing.count += 1;
    } else {
      // First (newest) row for this month becomes the cover.
      acc.months.set(month, { month, count: 1, coverId: id });
    }
  }

  return {
    years: [...years.values()]
      .sort((a, b) => b.year - a.year)
      .map((y) => ({
        year: y.year,
        count: y.count,
        months: [...y.months.values()].sort((a, b) => b.month - a.month),
      })),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @lumio/web test calendar-service`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/calendar-service.ts apps/web/src/lib/calendar-service.test.ts
git commit -m "feat(web): calendar facet service (server-side month bucketing)"
```

---

## Task 3: Apply the `month` filter in the list services

**Files:**
- Modify: `apps/web/src/lib/photos-service.ts:17-27`
- Modify: `apps/web/src/lib/photos-service.test.ts`
- Modify: `apps/web/src/lib/albums-service.ts:91-104`
- Modify: `apps/web/src/lib/albums-service.test.ts`
- Modify: `apps/web/src/lib/search-service.ts:12-28`
- Modify: `apps/web/src/lib/search-service.test.ts`

- [ ] **Step 1: Write the failing `listPhotos` month test**

In `apps/web/src/lib/photos-service.test.ts`, first widen the `fakeDb` so calls capture `where`. Replace the existing `fakeDb` definition (lines ~25-38) with:

```ts
function fakeDb(rows: ReturnType<typeof row>[]) {
  const calls: Array<{ skip?: number; take: number; where?: unknown; orderBy?: unknown }> = [];
  return {
    calls,
    photo: {
      findMany: async (args: { skip?: number; take: number; where?: unknown; orderBy?: unknown }) => {
        calls.push(args);
        const skip = args.skip ?? 0;
        return rows.slice(skip, skip + args.take);
      },
      count: async () => rows.length,
    },
  };
}
```

Then add this test inside `describe("listPhotos", ...)`:

```ts
it("filters by a UTC sortDate range when month is set", async () => {
  const db = fakeDb([row("a")]);
  await listPhotos({ limit: 50, offset: 0, month: "2026-06" }, db as never);
  expect(db.calls[0]?.where).toEqual({
    sortDate: {
      gte: new Date("2026-06-01T00:00:00.000Z"),
      lt: new Date("2026-07-01T00:00:00.000Z"),
    },
  });
});

it("uses an empty where when no month is set", async () => {
  const db = fakeDb([row("a")]);
  await listPhotos({ limit: 50, offset: 0 }, db as never);
  expect(db.calls[0]?.where).toEqual({});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @lumio/web test photos-service`
Expected: FAIL — `where` is `undefined` (listPhotos passes no `where` yet).

- [ ] **Step 3: Apply `month` in `listPhotos`**

In `apps/web/src/lib/photos-service.ts`, update the imports to add `monthRange`:

```ts
import type {
  ColorLabel,
  PhotoNeighbors,
  PhotoSort,
  PhotosPage,
  PhotosQuery,
  PhotoStripItem,
} from "@lumio/shared";
import { monthRange } from "@lumio/shared";
```

Then replace `listPhotos` (lines 17-27) with:

```ts
export async function listPhotos(
  params: PhotosQuery,
  db: Db = prisma,
): Promise<PhotosPage> {
  const { limit, offset, sort, month } = params;
  const where = month ? { sortDate: monthRange(month) } : {};
  const [rows, total] = await Promise.all([
    db.photo.findMany({ where, skip: offset, take: limit, orderBy: photoOrderBy(sort) }),
    db.photo.count({ where }),
  ]);
  return { items: rows.map(toPhotoDTO), total };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @lumio/web test photos-service`
Expected: PASS.

- [ ] **Step 5: Write the failing `listAlbumPhotos` month test**

In `apps/web/src/lib/albums-service.test.ts`, add inside `describe("listAlbumPhotos", ...)`:

```ts
it("ANDs a UTC sortDate range into the album where when month is set", async () => {
  const calls: Array<{ where?: unknown }> = [];
  const fakeDb = {
    album: { findUnique: async () => albumRow() },
    albumPhoto: {},
    photo: {
      findMany: async (args: { where?: unknown }) => {
        calls.push(args);
        return [];
      },
      count: async () => 0,
      findFirst: async () => null,
    },
  };
  await listAlbumPhotos("alb1", { limit: 2, offset: 0, month: "2026-06" }, fakeDb as never);
  expect(calls[0]?.where).toEqual({
    AND: [
      { albums: { some: { albumId: "alb1" } } },
      {
        sortDate: {
          gte: new Date("2026-06-01T00:00:00.000Z"),
          lt: new Date("2026-07-01T00:00:00.000Z"),
        },
      },
    ],
  });
});
```

- [ ] **Step 6: Run the test to verify it fails**

Run: `pnpm --filter @lumio/web test albums-service`
Expected: FAIL — `where` lacks the `AND`/`sortDate` range.

- [ ] **Step 7: Apply `month` in `listAlbumPhotos`**

In `apps/web/src/lib/albums-service.ts`, add `monthRange` to the `@lumio/shared` import:

```ts
import {
  type AlbumDTO,
  type AlbumSummaryDTO,
  type CreateAlbumInput,
  type PhotosPage,
  type PhotosQuery,
  type SmartAlbumRules,
  monthRange,
} from "@lumio/shared";
```

Then replace the body of `listAlbumPhotos` (lines 91-104) with:

```ts
export async function listAlbumPhotos(
  id: string,
  params: PhotosQuery,
  db: Db = prisma,
): Promise<PhotosPage | null> {
  const scoped = await albumPhotoWhere(id, db);
  if (scoped === null) return null;
  const { limit, offset, sort, month } = params;
  const where = month ? { AND: [scoped, { sortDate: monthRange(month) }] } : scoped;
  const [rows, total] = await Promise.all([
    db.photo.findMany({ where, skip: offset, take: limit, orderBy: photoOrderBy(sort) }),
    db.photo.count({ where }),
  ]);
  return { items: rows.map(toPhotoDTO), total };
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `pnpm --filter @lumio/web test albums-service`
Expected: PASS.

- [ ] **Step 9: Write the failing search-service month tests**

In `apps/web/src/lib/search-service.test.ts`, add inside `describe("searchPhotos", ...)`:

```ts
it("ANDs a UTC sortDate range into the search where when month is set", async () => {
  const db = fakeDb([row("a")]);
  await searchPhotos({ limit: 50, offset: 0, album: [], month: "2026-06" }, db as never);
  expect(db.calls[0]?.where).toEqual({
    AND: [
      {},
      {
        sortDate: {
          gte: new Date("2026-06-01T00:00:00.000Z"),
          lt: new Date("2026-07-01T00:00:00.000Z"),
        },
      },
    ],
  });
});
```

And add a new `describe` block for the count (after the `searchPhotos` describe):

```ts
describe("countSearchPhotos", () => {
  it("counts with the plain where when no month is set", async () => {
    const counts: Array<{ where?: unknown }> = [];
    const db = {
      photo: {
        count: async (args: { where?: unknown }) => {
          counts.push(args);
          return 7;
        },
      },
    };
    const total = await countSearchPhotos({ limit: 50, offset: 0, album: [] }, db as never);
    expect(total).toBe(7);
    expect(counts[0]?.where).toEqual({});
  });

  it("ANDs a sortDate range into the count where when month is set", async () => {
    const counts: Array<{ where?: unknown }> = [];
    const db = {
      photo: {
        count: async (args: { where?: unknown }) => {
          counts.push(args);
          return 2;
        },
      },
    };
    await countSearchPhotos({ limit: 50, offset: 0, album: [], month: "2026-06" }, db as never);
    expect(counts[0]?.where).toEqual({
      AND: [
        {},
        {
          sortDate: {
            gte: new Date("2026-06-01T00:00:00.000Z"),
            lt: new Date("2026-07-01T00:00:00.000Z"),
          },
        },
      ],
    });
  });
});
```

- [ ] **Step 10: Run the test to verify it fails**

Run: `pnpm --filter @lumio/web test search-service`
Expected: FAIL — month range not applied in `searchPhotos`/`countSearchPhotos`.

- [ ] **Step 11: Apply `month` in `search-service.ts`**

Replace the whole body of `apps/web/src/lib/search-service.ts` with:

```ts
import { type PrismaClient, buildSearchWhere, prisma, toPhotoDTO } from "@lumio/db";
import { type PhotosPage, type SearchQuery, monthRange } from "@lumio/shared";
import { photoOrderBy } from "@/lib/photo-order";

type Db = Pick<PrismaClient, "photo">;

/** Search where + the optional month range, AND-combined. */
function searchWhere(params: SearchQuery) {
  const scoped = buildSearchWhere(params);
  return params.month ? { AND: [scoped, { sortDate: monthRange(params.month) }] } : scoped;
}

/**
 * Search the library by structured filters (albums) + free-text filename match,
 * optionally narrowed to a single month. Same offset pagination as `listPhotos`.
 */
export async function searchPhotos(params: SearchQuery, db: Db = prisma): Promise<PhotosPage> {
  const { limit, offset, sort } = params;
  const where = searchWhere(params);
  const [rows, total] = await Promise.all([
    db.photo.findMany({ where, skip: offset, take: limit, orderBy: photoOrderBy(sort) }),
    db.photo.count({ where }),
  ]);
  return { items: rows.map(toPhotoDTO), total };
}

/**
 * Count photos matching the search filters (and month, if set) — same `where` as
 * `searchPhotos`, minus pagination. Powers the result count in the search toolbar.
 */
export async function countSearchPhotos(params: SearchQuery, db: Db = prisma): Promise<number> {
  return db.photo.count({ where: searchWhere(params) });
}
```

- [ ] **Step 12: Run the test to verify it passes**

Run: `pnpm --filter @lumio/web test search-service`
Expected: PASS.

- [ ] **Step 13: Commit**

```bash
git add apps/web/src/lib/photos-service.ts apps/web/src/lib/photos-service.test.ts \
  apps/web/src/lib/albums-service.ts apps/web/src/lib/albums-service.test.ts \
  apps/web/src/lib/search-service.ts apps/web/src/lib/search-service.test.ts
git commit -m "feat(web): apply month filter in library/album/search list services"
```

---

## Task 4: Calendar facet route handlers

**Files:**
- Create: `apps/web/src/app/api/photos/calendar/route.ts`
- Create: `apps/web/src/app/api/albums/[id]/calendar/route.ts`
- Create: `apps/web/src/app/api/search/calendar/route.ts`

No unit tests (the repo has no route-handler tests; logic lives in the tested service). Verify by typecheck/build in Task 7 and browser in Tasks 5–6.

- [ ] **Step 1: Create the library facets route**

Create `apps/web/src/app/api/photos/calendar/route.ts`:

```ts
import { NextResponse } from "next/server";
import { buildCalendarFacets } from "@/lib/calendar-service";
import { withAuth } from "@/lib/with-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async () => {
  const facets = await buildCalendarFacets({});
  return NextResponse.json(facets);
});
```

- [ ] **Step 2: Create the album facets route**

Create `apps/web/src/app/api/albums/[id]/calendar/route.ts`:

```ts
import { NextResponse } from "next/server";
import { albumPhotoWhere } from "@/lib/albums-service";
import { buildCalendarFacets } from "@/lib/calendar-service";
import { withAuth } from "@/lib/with-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(
  async (_request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const where = await albumPhotoWhere(id);
    if (where === null) {
      return NextResponse.json({ error: "Album not found" }, { status: 404 });
    }
    const facets = await buildCalendarFacets(where);
    return NextResponse.json(facets);
  },
);
```

- [ ] **Step 3: Create the search facets route**

Create `apps/web/src/app/api/search/calendar/route.ts` (mirrors the search route's `album`-repeat parsing; month is intentionally ignored so facets show every month in scope):

```ts
import { NextResponse } from "next/server";
import { buildSearchWhere } from "@lumio/db";
import { searchQuerySchema } from "@lumio/shared";
import { buildCalendarFacets } from "@/lib/calendar-service";
import { withAuth } from "@/lib/with-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (request) => {
  const { searchParams } = new URL(request.url);
  const parsed = searchQuerySchema.safeParse({
    ...Object.fromEntries(searchParams),
    album: searchParams.getAll("album"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  // buildSearchWhere reads only album + q, so any `month` param is ignored here.
  const facets = await buildCalendarFacets(buildSearchWhere(parsed.data));
  return NextResponse.json(facets);
});
```

- [ ] **Step 4: Typecheck the new routes**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: PASS (no type errors). If `tsc` is not configured this way, defer verification to Task 7's `build`.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/api/photos/calendar/route.ts" \
  "apps/web/src/app/api/albums/[id]/calendar/route.ts" \
  "apps/web/src/app/api/search/calendar/route.ts"
git commit -m "feat(web): calendar facet routes for library, album, and search scopes"
```

---

## Task 5: `GridCalendarMenu` flyout component

**Files:**
- Create: `apps/web/src/components/grid-calendar-menu.tsx`

Browser-verified (no unit test, matching the other `grid-*-menu` components).

- [ ] **Step 1: Create the component**

Create `apps/web/src/components/grid-calendar-menu.tsx`:

```tsx
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
    setLoading(true);
    setError(false);
    fetch(facetsEndpoint)
      .then((res) => (res.ok ? (res.json() as Promise<CalendarFacets>) : Promise.reject(new Error())))
      .then((data) => {
        if (cancelled) return;
        setFacets(data);
        // Default the visible year to the active month's year, else the newest.
        setActiveYear(selected?.year ?? data.years[0]?.year ?? null);
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
      <PopoverContent align="end" className="w-[22rem] p-0">
        {loading ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="size-5 animate-spin text-muted-foreground" aria-hidden />
          </div>
        ) : error ? (
          <div className="flex h-48 flex-col items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground">
            <span>Couldn’t load dates.</span>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>
        ) : !facets || facets.years.length === 0 ? (
          <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
            No photos to filter.
          </div>
        ) : (
          <div className="flex h-80">
            {/* Years (+ an All-photos reset) */}
            <ul className="w-24 shrink-0 overflow-y-auto border-r py-1">
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
            {/* Month cover tiles for the active year */}
            <div className="grid flex-1 auto-rows-min grid-cols-3 gap-2 overflow-y-auto p-2">
              {year?.months.map((m) => {
                const active = selected?.year === year.year && selected.month === m.month;
                return (
                  <button
                    key={m.month}
                    type="button"
                    onClick={() => pick(year.year, m.month)}
                    title={`${MONTH_ABBR[m.month - 1]} ${year.year} · ${m.count}`}
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
                      {MONTH_ABBR[m.month - 1]}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 2: Lint the component**

Run: `pnpm --filter @lumio/web lint`
Expected: PASS (no errors). If the `@next/next/no-img-element` disable comment is unnecessary in this config, the lint run will say so — remove it if flagged as an unused disable.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/grid-calendar-menu.tsx
git commit -m "feat(web): GridCalendarMenu year/month filter flyout"
```

---

## Task 6: Wire the menu into the three views

**Files:**
- Modify: `apps/web/src/app/(app)/photos/library-view.tsx`
- Modify: `apps/web/src/app/(app)/albums/[id]/album-view.tsx`
- Modify: `apps/web/src/app/(app)/search/search-view.tsx`
- Modify: `apps/web/src/app/(app)/search/use-search-count.ts`

### Library view

- [ ] **Step 1: Add the import and month state (library)**

In `apps/web/src/app/(app)/photos/library-view.tsx`, add the import next to the other grid-menu imports (after the `GridSortMenu` import line):

```tsx
import { GridCalendarMenu } from "@/components/grid-calendar-menu";
```

Add month state inside `LibraryView`, after the `useGridSort` line:

```tsx
  const [month, setMonth] = useState<string | null>(null);
```

- [ ] **Step 2: Render the menu in the (non-select) header toolbar (library)**

In the `HeaderBar` `actions` block, insert the calendar menu after `<GridSortMenu .../>` and before the Select `<Button>`:

```tsx
              <GridSortMenu sort={sort} onSortChange={setSort} />
              <GridCalendarMenu
                facetsEndpoint="/api/photos/calendar"
                value={month}
                onChange={setMonth}
              />
```

- [ ] **Step 3: Feed month into the provider key + params (library)**

Replace the `PhotoCollectionProvider` opening tag's `key` and `params` props:

```tsx
      <PhotoCollectionProvider
        key={`${sort}:${month ?? ""}`}
        endpoint="/api/photos"
        params={new URLSearchParams(month ? { sort, month } : { sort })}
        urlForId={(id) => photoHref(id, undefined, sort)}
        baseUrl="/photos"
      >
```

### Album view

- [ ] **Step 4: Add the import and month state (album)**

In `apps/web/src/app/(app)/albums/[id]/album-view.tsx`, add the import after the `GridSortMenu` import:

```tsx
import { GridCalendarMenu } from "@/components/grid-calendar-menu";
```

Add month state inside `AlbumView`, after the `useGridSort` line:

```tsx
  const [month, setMonth] = useState<string | null>(null);
```

- [ ] **Step 5: Render the menu in the (non-select) header toolbar (album)**

In the `HeaderBar` `actions` block, insert after `<GridSortMenu .../>` and before the Select `<Button>`:

```tsx
              <GridSortMenu sort={sort} onSortChange={setSort} />
              <GridCalendarMenu
                facetsEndpoint={`/api/albums/${albumId}/calendar`}
                value={month}
                onChange={setMonth}
              />
```

- [ ] **Step 6: Feed month into the provider key + params (album)**

Replace the `PhotoCollectionProvider` opening tag's `key` and `params`:

```tsx
      <PhotoCollectionProvider
        key={`${reloadKey}:${sort}:${month ?? ""}`}
        endpoint={`/api/albums/${albumId}/photos`}
        params={new URLSearchParams(month ? { sort, month } : { sort })}
        urlForId={(id) => photoHref(id, albumId, sort)}
        baseUrl={`/albums/${albumId}`}
      >
```

### Search view

- [ ] **Step 7: Make the search count month-aware**

In `apps/web/src/app/(app)/search/use-search-count.ts`, replace the whole file with:

```ts
"use client";

import { useEffect, useState } from "react";
import type { SearchCount } from "@lumio/shared";
import { type SearchFilters, paramsFor, serialize } from "./filters";

/**
 * Total photos matching the current search filters (and the selected month, if
 * any), for the toolbar count. Fetches `GET /api/search?count=1` when the
 * (serialized) filters or month change — sort-independent. Returns `null` while
 * loading, when disabled, or on error. Exposes the setter so the view can keep
 * the count in sync with in-place tile removal (e.g. after a delete).
 */
export function useSearchCount(
  filters: SearchFilters,
  enabled: boolean,
  month: string | null = null,
) {
  const [count, setCount] = useState<number | null>(null);
  const serialized = serialize(filters);

  useEffect(() => {
    if (!enabled) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCount(null);
      return;
    }
    let cancelled = false;
    setCount(null);
    const params = paramsFor(filters);
    if (month) params.set("month", month);
    params.set("count", "1");
    fetch(`/api/search?${params.toString()}`)
      .then((res) => (res.ok ? (res.json() as Promise<SearchCount>) : Promise.reject(new Error())))
      .then((data) => {
        if (!cancelled) setCount(data.total);
      })
      .catch(() => {
        if (!cancelled) setCount(null);
      });
    return () => {
      cancelled = true;
    };
    // `serialized` is the stable identity of `filters`; refetch when it, `month`,
    // or `enabled` changes. `filters`/`paramsFor` are excluded — they'd refetch
    // every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialized, enabled, month]);

  return [count, setCount] as const;
}
```

- [ ] **Step 8: Add the import and month state (search)**

In `apps/web/src/app/(app)/search/search-view.tsx`, add the import after the `GridViewMenu` import:

```tsx
import { GridCalendarMenu } from "@/components/grid-calendar-menu";
```

Add month state inside `SearchView`, after the `const { mode, setMode } = useGridView();` line:

```tsx
  const [month, setMonth] = useState<string | null>(null);
```

- [ ] **Step 9: Pass month into the count hook (search)**

Replace the `useSearchCount` call:

```tsx
  const [searchCount, setSearchCount] = useSearchCount(filters, active && !empty, month);
```

- [ ] **Step 10: Render the menu in the (non-select) toolbar (search)**

In the search toolbar's non-select branch, insert after `<GridSortMenu .../>` and before the Select `<Button>`:

```tsx
                      <GridSortMenu sort={sort} onSortChange={setSort} />
                      <GridCalendarMenu
                        facetsEndpoint={`/api/search/calendar?${paramsFor(filters).toString()}`}
                        value={month}
                        onChange={setMonth}
                      />
```

- [ ] **Step 11: Feed month into the provider key + params (search)**

Replace the `PhotoCollectionProvider` opening tag (the facets endpoint stays month-free; the grid params get month appended):

```tsx
              <PhotoCollectionProvider
                key={`${serialized}:${sort}:${month ?? ""}`}
                endpoint="/api/search"
                params={(() => {
                  const p = paramsFor(filters, sort);
                  if (month) p.set("month", month);
                  return p;
                })()}
                urlForId={(id) => `/photo/${id}?${scopeQuery(filters, sort)}`}
                baseUrl="/search"
              >
```

- [ ] **Step 12: Lint the modified views**

Run: `pnpm --filter @lumio/web lint`
Expected: PASS.

- [ ] **Step 13: Commit**

```bash
git add "apps/web/src/app/(app)/photos/library-view.tsx" \
  "apps/web/src/app/(app)/albums/[id]/album-view.tsx" \
  "apps/web/src/app/(app)/search/search-view.tsx" \
  "apps/web/src/app/(app)/search/use-search-count.ts"
git commit -m "feat(web): wire calendar month-filter into library, album, and search views"
```

---

## Task 7: Full verification + browser-verify

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `pnpm -r test`
Expected: PASS across `@lumio/shared` and `@lumio/web` (all new + existing tests).

- [ ] **Step 2: Lint**

Run: `pnpm --filter @lumio/web lint`
Expected: PASS (no errors/warnings).

- [ ] **Step 3: Production build (typechecks routes + components)**

Run: `pnpm --filter @lumio/web build`
Expected: build succeeds with no type errors.

- [ ] **Step 4: Browser-verify the flyout**

Start the app (`pnpm dev`) with the dev DB up and seeded, then in the browser:
- **Library**: click the calendar icon → flyout shows years (desc) with month cover tiles. Pick a month → grid shows only that month; the trigger shows e.g. `Jun 2026`. Click the calendar again → "All photos" → grid returns to the full library.
- **Album** (open any album): same flyout, scoped to the album's photos (covers/counts reflect the album). Pick a month → grid filters within the album.
- **Search** (type a query/`@album`): the calendar appears in the results toolbar. Picking a month filters the results, and the "N photos" count updates to match.
- Confirm cover thumbnails render and the active month tile shows a ring.

- [ ] **Step 5: Final commit (if any verification tweaks were needed)**

```bash
git add -A
git commit -m "chore: calendar month-filter verification tweaks"
```

(Skip if nothing changed.)

---

## Self-Review notes

- **Spec coverage:** facet service (Task 2) ✓; shared types + month param (Task 1) ✓; `monthRange`/UTC bucketing (Tasks 1–2) ✓; three list services honor month (Task 3) ✓; three facet routes (Task 4) ✓; `GridCalendarMenu` two-pane flyout with covers + "All photos" reset + active trigger (Task 5) ✓; wiring into Library/Album/Search with provider key+params (Task 6) ✓; search count consistency (Task 6, addition beyond spec to avoid a visible mismatch) ✓; Trash untouched ✓; tests + browser-verify (Task 7) ✓.
- **Type consistency:** `buildCalendarFacets(where, db)` returns `CalendarFacets`; `monthRange(month) → {gte, lt}`; `GridCalendarMenu` props `{facetsEndpoint, value, onChange}`; `useSearchCount(filters, enabled, month?)`. Names are consistent across tasks.
- **Note on in-app lightbox:** opening a photo from a month-filtered grid navigates within the filtered set automatically, because the client lightbox reads the (month-filtered) collection store — no change needed to `urlForId`/`scopeQuery`. Deep-linking a specific photo by URL is unscoped by month (month is component state, not URL-synced — a documented v1 non-goal).
