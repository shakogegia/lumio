# Search Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A `/search` page with a centered search box that slides up to a sticky header on Enter and shows a filtered photo grid, where filters are added as inline TributeJS tags (Album now; EXIF/etc. later via an extensible facet registry) plus free-text filename matching.

**Architecture:** Backend mirrors the existing library list — a pure `buildSearchWhere` (next to `smartAlbumWhere`), a `searchPhotos` service over `PHOTO_ORDER` keyset pagination, and a `GET /api/search` route. Frontend isolates all the contenteditable/Tribute DOM-glue inside one `<SearchInput>` that emits a clean `SearchFilters` object; `<SearchView>` owns the center→top CSS animation and reuses the existing `<PhotoGrid>` (given a new `params` prop) keyed by the active filters. A facet registry maps trigger options → chips → query params, so new taggable facets are one object.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind v4 + shadcn (Base UI), Prisma/Postgres, Zod, TributeJS, Vitest.

---

## File Structure

**Backend / shared (pure, TDD):**
- `packages/shared/src/api.ts` (modify) — add `searchQuerySchema` + `SearchQuery`.
- `packages/shared/src/api.test.ts` (modify) — schema tests.
- `packages/db/src/search.ts` (create) — `buildSearchWhere` pure where-builder.
- `packages/db/src/search.test.ts` (create) — where-builder tests.
- `packages/db/src/index.ts` (modify) — export `./search.js`.
- `apps/web/src/lib/search-service.ts` (create) — `searchPhotos`.
- `apps/web/src/lib/search-service.test.ts` (create) — service tests.
- `apps/web/src/app/api/search/route.ts` (create) — `GET /api/search`.

**Frontend:**
- `apps/web/src/lib/field-style.ts` (create) — shared shadcn field classes.
- `apps/web/src/components/ui/input.tsx` (modify) — use `fieldClassName`.
- `apps/web/src/app/(app)/photos/photo-grid.tsx` (modify) — add `params` prop.
- `apps/web/src/app/(app)/search/facets.ts` (create) — facet registry + Tribute option loader.
- `apps/web/src/app/(app)/search/filters.ts` (create) — pure `SearchFilters` helpers.
- `apps/web/src/app/(app)/search/filters.test.ts` (create) — helper tests.
- `apps/web/src/app/(app)/search/search-input.tsx` (create) — contenteditable + Tribute.
- `apps/web/src/app/(app)/search/search-empty.tsx` (create) — no-results state.
- `apps/web/src/app/(app)/search/search-view.tsx` (create) — animation + grid wiring.
- `apps/web/src/app/(app)/search/page.tsx` (create) — route.
- `apps/web/src/components/app-sidebar.tsx` (modify) — Search nav entry.
- `apps/web/src/tributejs.d.ts` (create) — ambient types for TributeJS.
- `apps/web/src/app/globals.css` (modify) — Tribute dropdown theming.
- `apps/web/package.json` (modify) — add `tributejs`.

**Note on testing strategy:** This repo unit-tests *pure logic* and *services* (with a fake `db`) and **browser-verifies UI/DOM glue** (per the photos-service / smart-albums test patterns; there is no jsdom setup — vitest runs `environment: "node"`). So the where-builder, schema, service, and pure filter helpers get unit tests; the contenteditable DOM reader, Tribute wiring, and animation are browser-verified in the final task. Do **not** add jsdom.

---

## Task 1: Search query schema (shared)

**Files:**
- Modify: `packages/shared/src/api.ts`
- Test: `packages/shared/src/api.test.ts`

- [ ] **Step 1: Write the failing tests** — append to `packages/shared/src/api.test.ts`:

```ts
import { searchQuerySchema } from "./api.js";

describe("searchQuerySchema", () => {
  it("defaults to empty album list and no q/cursor", () => {
    const parsed = searchQuerySchema.parse({});
    expect(parsed.album).toEqual([]);
    expect(parsed.q).toBeUndefined();
    expect(parsed.cursor).toBeUndefined();
    expect(parsed.limit).toBe(50);
  });

  it("wraps a single album string into an array", () => {
    expect(searchQuerySchema.parse({ album: "a1" }).album).toEqual(["a1"]);
  });

  it("passes an album array through", () => {
    expect(searchQuerySchema.parse({ album: ["a1", "a2"] }).album).toEqual(["a1", "a2"]);
  });

  it("trims q and drops empty/whitespace-only q", () => {
    expect(searchQuerySchema.parse({ q: "  beach  " }).q).toBe("beach");
    expect(searchQuerySchema.parse({ q: "   " }).q).toBeUndefined();
  });

  it("rejects limit above 100", () => {
    expect(() => searchQuerySchema.parse({ limit: "1000" })).toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @lumio/shared test -- api.test.ts`
Expected: FAIL — `searchQuerySchema` is not exported.

- [ ] **Step 3: Implement the schema** — append to `packages/shared/src/api.ts`:

```ts
/** Query params for GET /api/search. `album` may repeat in the query string. */
export const searchQuerySchema = z.object({
  q: z
    .string()
    .optional()
    .transform((v) => v?.trim() || undefined),
  album: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => (v == null ? [] : Array.isArray(v) ? v : [v])),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).optional(),
});

export type SearchQuery = z.infer<typeof searchQuerySchema>;
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @lumio/shared test -- api.test.ts`
Expected: PASS (all `photosQuerySchema` + `searchQuerySchema` tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/api.ts packages/shared/src/api.test.ts
git commit -m "feat(shared): add searchQuerySchema for /api/search"
```

---

## Task 2: `buildSearchWhere` (db)

**Files:**
- Create: `packages/db/src/search.ts`
- Create: `packages/db/src/search.test.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Write the failing tests** — create `packages/db/src/search.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildSearchWhere } from "./search.js";

describe("buildSearchWhere", () => {
  it("no filters → empty where (matches everything)", () => {
    expect(buildSearchWhere({ album: [] })).toEqual({});
  });

  it("albums only → membership in any of the albums", () => {
    expect(buildSearchWhere({ album: ["a1", "a2"] })).toEqual({
      AND: [{ albums: { some: { albumId: { in: ["a1", "a2"] } } } }],
    });
  });

  it("q only → case-insensitive path contains", () => {
    expect(buildSearchWhere({ album: [], q: "beach" })).toEqual({
      AND: [{ path: { contains: "beach", mode: "insensitive" } }],
    });
  });

  it("albums + q → AND of both clauses", () => {
    expect(buildSearchWhere({ album: ["a1"], q: "beach" })).toEqual({
      AND: [
        { albums: { some: { albumId: { in: ["a1"] } } } },
        { path: { contains: "beach", mode: "insensitive" } },
      ],
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @lumio/db test -- search.test.ts`
Expected: FAIL — cannot find `./search.js`.

- [ ] **Step 3: Implement the where-builder** — create `packages/db/src/search.ts`:

```ts
import type { Prisma } from "@prisma/client";

/**
 * Translate search filters into a Prisma Photo where clause. Mirrors
 * `smartAlbumWhere`'s style: pure, no DB access. Albums OR within the facet
 * (membership in any of the ids); facet clauses AND together. Empty filters
 * yield `{}` (matches the whole library, same as the unfiltered listing).
 */
export function buildSearchWhere(p: { q?: string; album: string[] }): Prisma.PhotoWhereInput {
  const clauses: Prisma.PhotoWhereInput[] = [];
  if (p.album.length > 0) {
    clauses.push({ albums: { some: { albumId: { in: p.album } } } });
  }
  if (p.q) {
    clauses.push({ path: { contains: p.q, mode: "insensitive" } });
  }
  return clauses.length > 0 ? { AND: clauses } : {};
}
```

- [ ] **Step 4: Export from the package barrel** — add to `packages/db/src/index.ts` (after the `smart-albums` export):

```ts
export * from "./search.js";
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @lumio/db test -- search.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/search.ts packages/db/src/search.test.ts packages/db/src/index.ts
git commit -m "feat(db): add buildSearchWhere photo filter builder"
```

---

## Task 3: `searchPhotos` service (web)

**Files:**
- Create: `apps/web/src/lib/search-service.ts`
- Create: `apps/web/src/lib/search-service.test.ts`

- [ ] **Step 1: Write the failing tests** — create `apps/web/src/lib/search-service.test.ts` (mirrors `photos-service.test.ts`'s `fakeDb`):

```ts
import { describe, expect, it } from "vitest";
import { searchPhotos } from "./search-service.js";

function row(id: string) {
  return {
    id,
    path: `${id}.jpg`,
    source: "filesystem" as const,
    takenAt: new Date("2024-01-01T00:00:00.000Z"),
    sortDate: new Date("2024-01-01T00:00:00.000Z"),
    width: 10,
    height: 10,
    hash: null,
    exif: {},
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
    updatedAt: new Date("2024-01-01T00:00:00.000Z"),
  };
}

function fakeDb(rows: ReturnType<typeof row>[]) {
  const calls: Array<{ take: number; where?: unknown; orderBy?: unknown }> = [];
  return {
    calls,
    photo: {
      findMany: async (args: { take: number; where?: unknown; orderBy?: unknown }) => {
        calls.push(args);
        return rows.slice(0, args.take);
      },
    },
  };
}

describe("searchPhotos", () => {
  it("builds the where from album + q and paginates over PHOTO_ORDER", async () => {
    const db = fakeDb([row("a"), row("b")]);
    const page = await searchPhotos({ limit: 2, album: ["alb1"], q: "beach" }, db as never);
    expect(page.items.map((p) => p.id)).toEqual(["a", "b"]);
    expect(page.nextCursor).toBe("b");
    expect(db.calls[0]?.where).toEqual({
      AND: [
        { albums: { some: { albumId: { in: ["alb1"] } } } },
        { path: { contains: "beach", mode: "insensitive" } },
      ],
    });
    expect(db.calls[0]?.orderBy).toEqual([{ sortDate: "desc" }, { id: "desc" }]);
  });

  it("uses an empty where when there are no filters", async () => {
    const db = fakeDb([row("a")]);
    const page = await searchPhotos({ limit: 2, album: [] }, db as never);
    expect(db.calls[0]?.where).toEqual({});
    expect(page.nextCursor).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @lumio/web test -- search-service.test.ts`
Expected: FAIL — cannot find `./search-service.js`.

- [ ] **Step 3: Implement the service** — create `apps/web/src/lib/search-service.ts`:

```ts
import { type PrismaClient, buildSearchWhere, prisma, toPhotoDTO } from "@lumio/db";
import type { PhotosPage, SearchQuery } from "@lumio/shared";
import { PHOTO_ORDER } from "@/lib/photo-order";

type Db = Pick<PrismaClient, "photo">;

/**
 * Search the library by structured filters (albums) + free-text filename match.
 * Same keyset-cursor pagination as `listPhotos`: the `where` only narrows the
 * same PHOTO_ORDER sequence, so cursors stay valid.
 */
export async function searchPhotos(params: SearchQuery, db: Db = prisma): Promise<PhotosPage> {
  const { limit, cursor } = params;
  const rows = await db.photo.findMany({
    where: buildSearchWhere(params),
    take: limit,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    orderBy: PHOTO_ORDER,
  });
  const nextCursor = rows.length === limit ? (rows[rows.length - 1]?.id ?? null) : null;
  return { items: rows.map(toPhotoDTO), nextCursor };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @lumio/web test -- search-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/search-service.ts apps/web/src/lib/search-service.test.ts
git commit -m "feat(web): add searchPhotos service"
```

---

## Task 4: `GET /api/search` route (web)

**Files:**
- Create: `apps/web/src/app/api/search/route.ts`

(No unit test — this repo does not unit-test route handlers; covered by the final browser-verify. Mirrors `apps/web/src/app/api/photos/route.ts`.)

- [ ] **Step 1: Implement the route** — create `apps/web/src/app/api/search/route.ts`:

```ts
import { NextResponse } from "next/server";
import { searchQuerySchema } from "@lumio/shared";
import { searchPhotos } from "@/lib/search-service";
import { withAuth } from "@/lib/with-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (request) => {
  const { searchParams } = new URL(request.url);
  // `album` may repeat; getAll preserves every value (Object.fromEntries keeps only the last).
  const parsed = searchQuerySchema.safeParse({
    ...Object.fromEntries(searchParams),
    album: searchParams.getAll("album"),
  });
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const page = await searchPhotos(parsed.data);
  return NextResponse.json(page);
});
```

- [ ] **Step 2: Typecheck/lint the new route**

Run: `pnpm --filter @lumio/web lint`
Expected: PASS (no errors in `api/search/route.ts`).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/api/search/route.ts
git commit -m "feat(web): add GET /api/search route"
```

---

## Task 5: `PhotoGrid` `params` prop (web)

**Files:**
- Modify: `apps/web/src/app/(app)/photos/photo-grid.tsx`

(UI component — verified by the final browser task. Existing callers pass no `params`, so behavior is unchanged for them.)

- [ ] **Step 1: Update `fetchPage` to merge extra params** — replace the existing `fetchPage` function (lines ~42-48) with:

```ts
async function fetchPage(
  endpoint: string,
  cursor: string | null,
  extra?: URLSearchParams,
): Promise<PhotosPage> {
  // Clone `extra` so we don't mutate the caller's object; preserves repeated keys (e.g. album).
  const params = new URLSearchParams(extra);
  params.set("limit", "50");
  if (cursor) params.set("cursor", cursor);
  const res = await fetch(`${endpoint}?${params.toString()}`);
  if (!res.ok) throw new Error("Failed to load photos");
  return res.json();
}
```

- [ ] **Step 2: Add the `params` prop to the component signature** — in the `PhotoGrid({ ... })` destructured props add `params`, and in the type block add its type:

```tsx
export function PhotoGrid({
  endpoint = "/api/photos",
  albumId,
  empty = PHOTOS_EMPTY,
  params,
  selectMode = false,
  selectedIds,
  onSelectionChange,
}: {
  endpoint?: string;
  albumId?: string;
  empty?: React.ReactNode;
  params?: URLSearchParams;
  selectMode?: boolean;
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
}) {
```

- [ ] **Step 3: Thread `params` into `loadMore`** — update the `fetchPage` call and the `useCallback` deps inside `loadMore`:

```tsx
  const loadMore = useCallback(async () => {
    if (loadingRef.current || done) return;
    loadingRef.current = true;
    setError(false);
    try {
      const page = await fetchPage(endpoint, cursor, params);
      setPhotos((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
      if (!page.nextCursor) setDone(true);
    } catch {
      setError(true);
    } finally {
      loadingRef.current = false;
    }
  }, [endpoint, cursor, done, params]);
```

- [ ] **Step 4: Lint to confirm no type/hook errors**

Run: `pnpm --filter @lumio/web lint`
Expected: PASS for `photo-grid.tsx` (note: a pre-existing setState-in-effect warning may already exist in this file — do not introduce new errors).

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(app)/photos/photo-grid.tsx"
git commit -m "feat(web): add params prop to PhotoGrid for filtered endpoints"
```

---

## Task 6: Install TributeJS + ambient types

**Files:**
- Modify: `apps/web/package.json` (via install)
- Create: `apps/web/src/tributejs.d.ts`

- [ ] **Step 1: Install the dependency**

Run: `pnpm --filter @lumio/web add tributejs`
Expected: `tributejs` appears under `dependencies` in `apps/web/package.json`.

- [ ] **Step 2: Add the ambient type declaration** — create `apps/web/src/tributejs.d.ts` (TributeJS ships no bundled TS types):

```ts
// Minimal ambient types for the TributeJS surface we use.
// If a future tributejs version ships its own types and TS reports a duplicate
// declaration, delete this file.
declare module "tributejs" {
  interface TributeItem<T> {
    original: T;
  }
  interface TributeCollection<T> {
    trigger?: string;
    values:
      | T[]
      | ((text: string, cb: (values: T[]) => void) => void);
    lookup?: string | ((item: T, text: string) => string);
    fillAttr?: string;
    allowSpaces?: boolean;
    selectTemplate?: (item: TributeItem<T> | undefined) => string;
    menuItemTemplate?: (item: TributeItem<T>) => string;
    noMatchTemplate?: () => string;
    containerClass?: string;
    itemClass?: string;
    selectClass?: string;
  }
  export default class Tribute<T> {
    constructor(options: TributeCollection<T>);
    isActive: boolean;
    attach(el: HTMLElement | NodeList | HTMLCollection): void;
    detach(el: HTMLElement | NodeList | HTMLCollection): void;
  }
}
```

- [ ] **Step 3: Verify the type resolves**

Run: `pnpm --filter @lumio/web lint`
Expected: PASS (no "cannot find module 'tributejs'" error). If lint reports a *duplicate* module declaration, delete `apps/web/src/tributejs.d.ts` (the package now ships its own types) and re-run.

- [ ] **Step 4: Commit**

```bash
git add apps/web/package.json apps/web/src/tributejs.d.ts pnpm-lock.yaml
git commit -m "build(web): add tributejs dependency + ambient types"
```

---

## Task 7: Tribute dropdown theming (web)

**Files:**
- Modify: `apps/web/src/app/globals.css`

(Styling — browser-verified. Uses the app's theme tokens so it matches the popover in light/dark.)

- [ ] **Step 1: Append the Tribute menu styles** to the end of `apps/web/src/app/globals.css`:

```css
/* TributeJS dropdown — themed to match the app popover (light + dark via tokens). */
.tribute-container {
  position: absolute;
  z-index: 50;
  max-height: 18rem;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--popover);
  color: var(--popover-foreground);
  box-shadow: 0 8px 24px rgb(0 0 0 / 0.12);
}
.tribute-container ul {
  margin: 0;
  padding: 0.25rem;
  list-style: none;
}
.tribute-container li {
  padding: 0.375rem 0.625rem;
  border-radius: var(--radius-sm);
  font-size: 0.875rem;
  cursor: default;
}
.tribute-container li.highlight,
.tribute-container li:hover {
  background: var(--accent);
  color: var(--accent-foreground);
}
.tribute-container li.no-match {
  color: var(--muted-foreground);
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/globals.css
git commit -m "style(web): theme TributeJS dropdown to match popover"
```

---

## Task 8: Shared field style + Input refactor (web)

**Files:**
- Create: `apps/web/src/lib/field-style.ts`
- Modify: `apps/web/src/components/ui/input.tsx`

(Refactor that keeps `<Input>` visually identical while exposing the classes for the search box.)

- [ ] **Step 1: Create the shared field class string** — `apps/web/src/lib/field-style.ts`:

```ts
/**
 * The shadcn input field styling, extracted so the contenteditable search box
 * (which can't be a real <input>) renders identically to <Input>. File-input
 * specific classes stay in the Input component.
 */
export const fieldClassName =
  "h-9 w-full min-w-0 rounded-4xl border border-input bg-input/30 px-3 py-1 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-[3px] aria-invalid:ring-destructive/20 md:text-sm dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40";
```

- [ ] **Step 2: Refactor `Input` to consume it** — replace the body of `apps/web/src/components/ui/input.tsx` with:

```tsx
import * as React from "react"

import { cn } from "@/lib/utils"
import { fieldClassName } from "@/lib/field-style"

const FILE_CLASSES =
  "file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(fieldClassName, FILE_CLASSES, className)}
      {...props}
    />
  )
}

export { Input }
```

- [ ] **Step 3: Lint**

Run: `pnpm --filter @lumio/web lint`
Expected: PASS for `input.tsx` and `field-style.ts`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/field-style.ts apps/web/src/components/ui/input.tsx
git commit -m "refactor(web): extract shared field className from Input"
```

---

## Task 9: Facet registry (web)

**Files:**
- Create: `apps/web/src/app/(app)/search/facets.ts`

(Thin fetch/registry layer — browser-verified via the menu in the final task.)

- [ ] **Step 1: Implement the registry** — create `apps/web/src/app/(app)/search/facets.ts`:

```ts
import type { AlbumSummaryDTO } from "@lumio/shared";

/** One selectable value within a facet (album: value=id, label=name). */
export interface FacetOption {
  value: string;
  label: string;
}

/** A taggable dimension. Add a new facet by adding one of these to FACETS. */
export interface SearchFacet {
  /** Filter discriminator, also used as the chip's data-facet. */
  key: string;
  /** Human label shown in the menu group and chip prefix. */
  label: string;
  /** Fetch the selectable options for this facet. */
  loadOptions: () => Promise<FacetOption[]>;
}

/** Flattened option as fed to TributeJS — carries its facet identity. */
export interface TributeFacetItem {
  facetKey: string;
  facetLabel: string;
  value: string;
  label: string;
}

const albumFacet: SearchFacet = {
  key: "album",
  label: "Album",
  loadOptions: async () => {
    const res = await fetch("/api/albums");
    if (!res.ok) return [];
    const data: { items: AlbumSummaryDTO[] } = await res.json();
    return data.items.map((a) => ({ value: a.id, label: a.name }));
  },
};

/** The registry. Future facets (camera, date, …) are added here. */
export const FACETS: SearchFacet[] = [albumFacet];

let cache: Promise<TributeFacetItem[]> | null = null;

/**
 * Load every facet's options as one flat list for the Tribute menu. Cached for
 * the lifetime of the page (new albums show after a reload — acceptable for now).
 */
export function loadAllOptions(): Promise<TributeFacetItem[]> {
  if (!cache) {
    cache = Promise.all(
      FACETS.map((facet) =>
        facet.loadOptions().then((opts) =>
          opts.map((o) => ({
            facetKey: facet.key,
            facetLabel: facet.label,
            value: o.value,
            label: o.label,
          })),
        ),
      ),
    ).then((groups) => groups.flat());
  }
  return cache;
}
```

- [ ] **Step 2: Lint**

Run: `pnpm --filter @lumio/web lint`
Expected: PASS for `facets.ts`.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/(app)/search/facets.ts"
git commit -m "feat(web): add extensible search facet registry"
```

---

## Task 10: Pure filter helpers (web)

**Files:**
- Create: `apps/web/src/app/(app)/search/filters.ts`
- Create: `apps/web/src/app/(app)/search/filters.test.ts`

- [ ] **Step 1: Write the failing tests** — create `apps/web/src/app/(app)/search/filters.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildFilters, paramsFor, serialize } from "./filters.js";

describe("buildFilters", () => {
  it("dedupes albums and trims free text", () => {
    expect(buildFilters(["a1", "a1", "a2"], "  beach  ")).toEqual({
      albums: ["a1", "a2"],
      q: "beach",
    });
  });

  it("trims and normalizes the non-breaking spaces chips insert", () => {
    expect(buildFilters([], "\u00a0a\u00a0b\u00a0")).toEqual({ albums: [], q: "a b" });
  });
});

describe("paramsFor", () => {
  it("appends a repeated album param and sets q only when present", () => {
    const p = paramsFor({ albums: ["a1", "a2"], q: "beach" });
    expect(p.getAll("album")).toEqual(["a1", "a2"]);
    expect(p.get("q")).toBe("beach");
  });

  it("omits q when empty", () => {
    expect(paramsFor({ albums: [], q: "" }).has("q")).toBe(false);
  });
});

describe("serialize", () => {
  it("is order-independent across albums", () => {
    expect(serialize({ albums: ["a", "b"], q: "x" })).toBe(
      serialize({ albums: ["b", "a"], q: "x" }),
    );
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @lumio/web test -- search/filters.test.ts`
Expected: FAIL — cannot find `./filters.js`.

- [ ] **Step 3: Implement the helpers** — create `apps/web/src/app/(app)/search/filters.ts`:

```ts
/** The structured search state the rest of the app consumes. */
export interface SearchFilters {
  albums: string[];
  q: string;
}

/** Build normalized filters from raw album ids + free text (deduped, trimmed). */
export function buildFilters(albums: string[], rawText: string): SearchFilters {
  return {
    albums: Array.from(new Set(albums.filter(Boolean))),
    q: rawText.replace(/\u00a0/g, " ").trim(),
  };
}

/** Filters → query string for GET /api/search (album repeats; q only when set). */
export function paramsFor(filters: SearchFilters): URLSearchParams {
  const params = new URLSearchParams();
  for (const album of filters.albums) params.append("album", album);
  if (filters.q) params.set("q", filters.q);
  return params;
}

/** Stable key for remounting the results grid when the filters change. */
export function serialize(filters: SearchFilters): string {
  return JSON.stringify({ albums: [...filters.albums].sort(), q: filters.q });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @lumio/web test -- search/filters.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(app)/search/filters.ts" "apps/web/src/app/(app)/search/filters.test.ts"
git commit -m "feat(web): add pure search filter helpers"
```

---

## Task 11: `SearchInput` component (web)

**Files:**
- Create: `apps/web/src/app/(app)/search/search-input.tsx`

(Contenteditable + Tribute DOM glue — browser-verified in the final task. Reads its own DOM into `SearchFilters` via the pure `buildFilters` from Task 10.)

- [ ] **Step 1: Implement the component** — create `apps/web/src/app/(app)/search/search-input.tsx`:

```tsx
"use client";

import { useEffect, useRef } from "react";
import type Tribute from "tributejs";
import { cn } from "@/lib/utils";
import { fieldClassName } from "@/lib/field-style";
import { type TributeFacetItem, loadAllOptions } from "./facets";
import { type SearchFilters, buildFilters } from "./filters";

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );
}

/** Inline, non-editable tag inserted into the contenteditable when an option is picked. */
function chipHtml(item: TributeFacetItem): string {
  const facet = escapeHtml(item.facetKey);
  const value = escapeHtml(item.value);
  const prefix = escapeHtml(item.facetLabel);
  const label = escapeHtml(item.label);
  return (
    `<span contenteditable="false" data-facet="${facet}" data-value="${value}" ` +
    `class="mx-0.5 inline-flex items-center gap-1 rounded-full border border-border bg-accent px-2 py-0.5 align-middle text-sm text-accent-foreground">` +
    `<span class="text-muted-foreground">${prefix}:</span>${label}` +
    `<button type="button" data-chip-remove tabindex="-1" class="ml-0.5 leading-none text-muted-foreground hover:text-foreground">×</button>` +
    `</span>&nbsp;`
  );
}

/** Read the editor DOM into structured filters: chip spans → albums, text → q. */
function readEditor(el: HTMLElement): SearchFilters {
  const albums: string[] = [];
  el.querySelectorAll<HTMLElement>('[data-facet="album"]').forEach((chip) => {
    const value = chip.getAttribute("data-value");
    if (value) albums.push(value);
  });

  let rawText = "";
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    // Skip text that lives inside a chip span.
    if (!node.parentElement?.closest("[data-facet]")) rawText += node.textContent ?? "";
    node = walker.nextNode();
  }
  return buildFilters(albums, rawText);
}

export function SearchInput({
  hero,
  onSubmit,
}: {
  hero: boolean;
  onSubmit: (filters: SearchFilters) => void;
}) {
  const editorRef = useRef<HTMLDivElement>(null);
  const tributeRef = useRef<Tribute<TributeFacetItem> | null>(null);

  useEffect(() => {
    let cancelled = false;
    let tribute: Tribute<TributeFacetItem> | null = null;
    const el = editorRef.current;

    void (async () => {
      const { default: TributeCtor } = await import("tributejs");
      if (cancelled || !el) return;
      tribute = new TributeCtor<TributeFacetItem>({
        trigger: "@",
        allowSpaces: true,
        lookup: "label",
        fillAttr: "label",
        values: (_text, cb) => {
          loadAllOptions()
            .then((opts) => cb(opts))
            .catch(() => cb([]));
        },
        menuItemTemplate: (item) =>
          `<span class="text-muted-foreground">${escapeHtml(item.original.facetLabel)}</span> · ${escapeHtml(item.original.label)}`,
        selectTemplate: (item) => (item ? chipHtml(item.original) : ""),
        noMatchTemplate: () => "",
      });
      tribute.attach(el);
      tributeRef.current = tribute;
    })();

    return () => {
      cancelled = true;
      if (tribute && el) tribute.detach(el);
      tributeRef.current = null;
    };
  }, []);

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Enter") return;
    // While the Tribute menu is open, Enter selects an option — let it through.
    if (tributeRef.current?.isActive) return;
    e.preventDefault();
    if (editorRef.current) onSubmit(readEditor(editorRef.current));
  }

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    const remove = (e.target as HTMLElement).closest("[data-chip-remove]");
    if (!remove) return;
    e.preventDefault();
    remove.closest("[data-facet]")?.remove();
  }

  return (
    <div
      ref={editorRef}
      role="searchbox"
      aria-label="Search photos"
      contentEditable
      suppressContentEditableWarning
      data-placeholder="Search photos…  (type @ to filter by album)"
      onKeyDown={handleKeyDown}
      onClick={handleClick}
      className={cn(
        fieldClassName,
        "flex h-auto flex-wrap items-center gap-1 transition-all duration-300",
        "before:pointer-events-none before:text-muted-foreground empty:before:content-[attr(data-placeholder)]",
        hero ? "min-h-14 px-5 text-lg" : "min-h-9 text-base md:text-sm",
      )}
    />
  );
}
```

- [ ] **Step 2: Lint**

Run: `pnpm --filter @lumio/web lint`
Expected: PASS for `search-input.tsx`.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/(app)/search/search-input.tsx"
git commit -m "feat(web): add Tribute-powered SearchInput"
```

---

## Task 12: `SearchEmpty` no-results state (web)

**Files:**
- Create: `apps/web/src/app/(app)/search/search-empty.tsx`

- [ ] **Step 1: Implement the empty state** — create `apps/web/src/app/(app)/search/search-empty.tsx` (mirrors `PHOTOS_EMPTY` in `photo-grid.tsx`):

```tsx
import { SearchX } from "lucide-react";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

export function SearchEmpty() {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SearchX />
        </EmptyMedia>
        <EmptyTitle>No photos match your search</EmptyTitle>
        <EmptyDescription>Try a different album or search term.</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
```

- [ ] **Step 2: Lint**

Run: `pnpm --filter @lumio/web lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/(app)/search/search-empty.tsx"
git commit -m "feat(web): add search no-results empty state"
```

---

## Task 13: `SearchView` (animation + grid wiring) (web)

**Files:**
- Create: `apps/web/src/app/(app)/search/search-view.tsx`

(The center→top animation + results grid — browser-verified in the final task.)

- [ ] **Step 1: Implement the view** — create `apps/web/src/app/(app)/search/search-view.tsx`:

```tsx
"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { PhotoGrid } from "../photos/photo-grid";
import { SearchInput } from "./search-input";
import { SearchEmpty } from "./search-empty";
import { type SearchFilters, paramsFor, serialize } from "./filters";

export function SearchView() {
  const [submitted, setSubmitted] = useState<SearchFilters | null>(null);
  const searched = submitted !== null;

  return (
    <div className="relative">
      {/* Search box: centered in the hero, then pinned at the top after a search.
          -mx-6/px-6 + bg-background mirror HeaderBar so it spans full width and
          content scrolls cleanly beneath it once pinned. */}
      <div
        className={cn(
          "sticky top-0 z-20 -mx-6 bg-background px-6 transition-transform duration-500 ease-out",
          searched ? "translate-y-0 py-4" : "translate-y-[35vh] py-0",
        )}
      >
        <div className="mx-auto w-full max-w-2xl">
          <div
            className={cn(
              "overflow-hidden text-center transition-all duration-300",
              searched ? "max-h-0 opacity-0" : "mb-6 max-h-40 opacity-100",
            )}
          >
            <h1 className="text-3xl font-semibold">Search your photos</h1>
            <p className="mt-2 text-muted-foreground">Type @ to filter by album</p>
          </div>
          <SearchInput hero={!searched} onSubmit={setSubmitted} />
        </div>
      </div>

      {searched && submitted && (
        <div className="animate-in fade-in pt-2 duration-500">
          <PhotoGrid
            key={serialize(submitted)}
            endpoint="/api/search"
            params={paramsFor(submitted)}
            empty={<SearchEmpty />}
          />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Lint**

Run: `pnpm --filter @lumio/web lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/(app)/search/search-view.tsx"
git commit -m "feat(web): add SearchView with center-to-top animation"
```

---

## Task 14: `/search` page + sidebar entry (web)

**Files:**
- Create: `apps/web/src/app/(app)/search/page.tsx`
- Modify: `apps/web/src/components/app-sidebar.tsx`

- [ ] **Step 1: Create the route** — `apps/web/src/app/(app)/search/page.tsx` (matches `photos/page.tsx`'s `<main>` wrapper):

```tsx
import { SearchView } from "./search-view";

export default function SearchPage() {
  return (
    <main className="w-full px-6 pb-6">
      <SearchView />
    </main>
  );
}
```

- [ ] **Step 2: Add the sidebar entry** — in `apps/web/src/components/app-sidebar.tsx`:

Update the lucide import (line 5) to include `Search`:

```tsx
import { ArrowLeft, Images, GalleryVerticalEnd, ImageUp, Search } from "lucide-react";
```

Add `Search` as the first `PRIMARY` item:

```tsx
const PRIMARY: NavItem[] = [
  { href: "/search", label: "Search", icon: Search, match: ["/search"] },
  { href: "/photos", label: "Photos", icon: Images, match: ["/photos", "/photo"] },
  { href: "/albums", label: "Albums", icon: GalleryVerticalEnd, match: ["/albums"] },
  { href: "/upload", label: "Upload", icon: ImageUp, match: ["/upload"] },
];
```

- [ ] **Step 3: Lint**

Run: `pnpm --filter @lumio/web lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/(app)/search/page.tsx" apps/web/src/components/app-sidebar.tsx
git commit -m "feat(web): add /search page and sidebar entry"
```

---

## Task 15: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full web + package test suites**

Run: `pnpm --filter @lumio/shared test && pnpm --filter @lumio/db test && pnpm --filter @lumio/web test`
Expected: all suites PASS (existing 83 + the new search tests).

- [ ] **Step 2: Lint the whole web app**

Run: `pnpm --filter @lumio/web lint`
Expected: no **new** errors (a pre-existing setState-in-effect warning in `photos/photo-grid.tsx` is unrelated).

- [ ] **Step 3: Production build**

Run: `pnpm --filter @lumio/web build`
Expected: build succeeds; `/search` appears in the route output.

- [ ] **Step 4: Browser-verify** (dev server running; sign in)

Verify the full flow in a real browser (per the project's browser-verify practice — use element refs, not pixel clicks):
  1. Sidebar shows **Search** first; clicking it routes to `/search`.
  2. The search box is **centered** with the "Search your photos" heading + hint, and looks **identical to a shadcn input** (pill, border, focus ring).
  3. Typing `@` opens a dropdown **styled like the app popover**, listing `Album · <name>` rows; filtering by text narrows it.
  4. Selecting an album inserts an **inline chip** ("Album: <name> ×"); typing free text after it works.
  5. Pressing **Enter** smoothly **slides the box to the top** (sticky), fades out the hero copy, and **fades in the results grid** filtered to photos in that album whose filename contains the text.
  6. Clicking a chip's **×** removes it; **Backspace** at the chip boundary deletes it.
  7. A query with no matches shows the **"No photos match your search"** empty state.
  8. The existing `/photos` and `/albums/[id]` grids still load (PhotoGrid `params` change is backward-compatible).

- [ ] **Step 5: Final commit (if any verification fixups were made)**

```bash
git add -A
git commit -m "test(web): verify search page end-to-end"
```

---

## Self-Review notes (for the implementer)

- **Spec coverage:** sidebar entry (T14), center→top animation (T13), shadcn-look contenteditable (T8/T11), single-trigger `@` union menu + inline chips (T9/T11), facet registry extensibility (T9), filtering semantics albums-OR / AND text (T2), `buildSearchWhere`/`searchPhotos`/`/api/search` (T2/T3/T4), PhotoGrid reuse via `params`+`key` (T5/T13), Tribute theming (T7), tests (T1/T2/T3/T10) + browser-verify (T15) — all covered.
- **Refinement vs. spec:** the spec named a single `parseEditor`; the plan splits it into the pure, unit-tested `buildFilters` (Task 10) plus a thin DOM reader `readEditor` inside `SearchInput` (Task 11, browser-verified), because the repo has no jsdom setup and tests pure logic only. Same behavior, repo-consistent testing.
- **Type consistency:** `SearchFilters { albums: string[]; q: string }`, `SearchQuery { q?; album: string[]; limit; cursor? }`, `buildSearchWhere({ q?; album })`, `TributeFacetItem { facetKey; facetLabel; value; label }`, `loadAllOptions()`, `paramsFor`/`serialize`/`buildFilters` — names match across all tasks.
