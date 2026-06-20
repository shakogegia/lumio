# Client-side Photo Lightbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-photo route navigation with a client-owned lightbox that reads from a shared, grid-backed photo store, so photo↔photo navigation is instant (no RSC round-trip, no remount), the stuck-blur bug is fixed, and `/photo/[id]` URLs stay deep-linkable.

**Architecture:** Lift the grid's `usePhotoPages` store into a `PhotoCollectionProvider`; both `PhotoGrid` and a new client `Lightbox` read from it. Navigation = an index change in client state, with the URL synced via `window.history.pushState/replaceState` (never Next's router). Deep links keep the real `/photo/[id]` route, which SSRs the photo + its index (a new read-only `locate` query) and pre-opens the lightbox.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Prisma, Vitest (node env, dependency-injected fake-db tests), Tailwind, `@tanstack/react-virtual`.

**Reference spec:** `docs/superpowers/specs/2026-06-20-client-lightbox-photo-navigation-design.md`

---

## Conventions for this plan

- **Run commands from the repo root** `/Users/gego/conductor/workspaces/lumio/baghdad`.
- **Test one file:** `pnpm --filter @lumio/web exec vitest run <path>`
- **Test all web:** `pnpm --filter @lumio/web test`
- **Lint:** `pnpm --filter @lumio/web lint`
- **Typecheck:** `pnpm --filter @lumio/web exec tsc --noEmit`
- The DB must be up for the dev server (`pnpm db:up`); **unit tests use injected fake `db` objects and need no database** (see `photos-service.test.ts`).
- **Test pattern:** services take a `db = prisma` param; tests pass a fake (`db as never`). Hooks export pure functions that are unit-tested (e.g. `parseGridSort`). Follow this — never render React in a test (there is no jsdom/testing-library).
- Port tasks cite exact `file:line` ranges to move verbatim; only the changed lines are reproduced.

---

## Phase A — `locate` (server: a photo's index within a scope)

### Task 1: `locatePhoto` + `beforeCursorWhere`

**Files:**
- Create: `apps/web/src/lib/locate-photo.ts`
- Test: `apps/web/src/lib/locate-photo.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/lib/locate-photo.test.ts
import { describe, expect, it, vi } from "vitest";
import { beforeCursorWhere, locatePhoto } from "./locate-photo.js";

const cursor = {
  id: "p5",
  sortDate: new Date("2024-03-01T00:00:00.000Z"),
  createdAt: new Date("2024-05-01T00:00:00.000Z"),
};

describe("beforeCursorWhere", () => {
  it("taken-desc: earlier index = greater sortDate, id tiebreak desc", () => {
    expect(beforeCursorWhere("taken-desc", cursor)).toEqual({
      OR: [
        { sortDate: { gt: cursor.sortDate } },
        { AND: [{ sortDate: cursor.sortDate }, { id: { gt: "p5" } }] },
      ],
    });
  });

  it("taken-asc: earlier index = lesser sortDate, id tiebreak asc", () => {
    expect(beforeCursorWhere("taken-asc", cursor)).toEqual({
      OR: [
        { sortDate: { lt: cursor.sortDate } },
        { AND: [{ sortDate: cursor.sortDate }, { id: { lt: "p5" } }] },
      ],
    });
  });

  it("imported-desc: keys on createdAt", () => {
    expect(beforeCursorWhere("imported-desc", cursor)).toEqual({
      OR: [
        { createdAt: { gt: cursor.createdAt } },
        { AND: [{ createdAt: cursor.createdAt }, { id: { gt: "p5" } }] },
      ],
    });
  });
});

describe("locatePhoto", () => {
  function db(opts: { row: typeof cursor | null; before: number; inScope: number }) {
    const counts: Array<Record<string, unknown>> = [];
    return {
      counts,
      photo: {
        findUnique: vi.fn(async () => opts.row),
        count: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
          counts.push(where);
          // Distinguish the "before" count from the "in scope" probe by shape.
          return JSON.stringify(where).includes('"OR"') ? opts.before : opts.inScope;
        }),
      },
    };
  }

  it("returns the before-count as the index when the photo is in scope", async () => {
    const fake = db({ row: cursor, before: 7, inScope: 1 });
    const idx = await locatePhoto("p5", { kind: "library", sort: "taken-desc" }, fake as never);
    expect(idx).toBe(7);
  });

  it("returns null when the photo does not exist", async () => {
    const fake = db({ row: null, before: 0, inScope: 0 });
    const idx = await locatePhoto("missing", { kind: "library", sort: "taken-desc" }, fake as never);
    expect(idx).toBeNull();
    expect(fake.photo.count).not.toHaveBeenCalled();
  });

  it("returns null when the photo is outside the scope", async () => {
    const fake = db({ row: cursor, before: 3, inScope: 0 });
    const idx = await locatePhoto("p5", { kind: "library", sort: "taken-desc" }, fake as never);
    expect(idx).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm --filter @lumio/web exec vitest run src/lib/locate-photo.test.ts`
Expected: FAIL — `locate-photo.js` not found / `beforeCursorWhere is not a function`.

- [ ] **Step 3: Implement**

```ts
// apps/web/src/lib/locate-photo.ts
import { buildSearchWhere, type Prisma, type PrismaClient, prisma } from "@lumio/db";
import type { PhotoSort } from "@lumio/shared";
import { albumPhotoWhere } from "@/lib/albums-service";
import type { DetailScope } from "@/lib/photo-detail-loader";

export interface PhotoCursor {
  id: string;
  sortDate: Date;
  createdAt: Date;
}

type LocateDb = Pick<PrismaClient, "photo" | "album">;

/**
 * Prisma `where` matching every photo that sorts strictly BEFORE `cursor` in the
 * given sort order — i.e. the photos at lower grid indices. Mirrors
 * `photoOrderBy`: the date field, then `id`, in the same direction. Counting the
 * matches yields the cursor photo's absolute index in the ordered set.
 */
export function beforeCursorWhere(
  sort: PhotoSort | undefined,
  cursor: PhotoCursor,
): Prisma.PhotoWhereInput {
  const imported = sort === "imported-desc" || sort === "imported-asc";
  const field = imported ? "createdAt" : "sortDate";
  const value = imported ? cursor.createdAt : cursor.sortDate;
  const asc = sort === "taken-asc" || sort === "imported-asc";
  const dateBefore = asc ? { lt: value } : { gt: value };
  const idBefore = asc ? { lt: cursor.id } : { gt: cursor.id };
  return {
    OR: [{ [field]: dateBefore }, { AND: [{ [field]: value }, { id: idBefore }] }],
  } as Prisma.PhotoWhereInput;
}

async function scopeWhereFor(
  scope: DetailScope,
  db: LocateDb,
): Promise<Prisma.PhotoWhereInput | null> {
  if (scope.kind === "album") return albumPhotoWhere(scope.albumId, db);
  if (scope.kind === "search") return buildSearchWhere({ album: scope.albums, q: scope.q });
  return {};
}

/**
 * Absolute index of `id` within a navigation scope's ordered set — the grid
 * offset the photo occupies, used to open the lightbox at the right position on a
 * deep link. Returns null when the photo is missing or outside the scope. Reuses
 * the SAME `where` + order (`photoOrderBy`) as the grid list endpoints and the
 * neighbor query, so the index aligns with the grid's offset pagination.
 */
export async function locatePhoto(
  id: string,
  scope: DetailScope,
  db: LocateDb = prisma,
): Promise<number | null> {
  const row = await db.photo.findUnique({
    where: { id },
    select: { id: true, sortDate: true, createdAt: true },
  });
  if (!row) return null;
  const scopeWhere = await scopeWhereFor(scope, db);
  if (scopeWhere === null) return null;
  const [index, inScope] = await Promise.all([
    db.photo.count({ where: { AND: [scopeWhere, beforeCursorWhere(scope.sort, row)] } }),
    db.photo.count({ where: { AND: [scopeWhere, { id }] } }),
  ]);
  return inScope > 0 ? index : null;
}
```

> **Note:** confirm `buildSearchWhere` is exported from `@lumio/db` (it is imported from there in `photo-detail-loader.ts:1`). If `Prisma` is not re-exported from `@lumio/db`, import the type from `@prisma/client` as `photos-service.ts` patterns dictate.

- [ ] **Step 4: Run it, verify it passes**

Run: `pnpm --filter @lumio/web exec vitest run src/lib/locate-photo.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Lint + typecheck**

Run: `pnpm --filter @lumio/web lint && pnpm --filter @lumio/web exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/locate-photo.ts apps/web/src/lib/locate-photo.test.ts
git commit -m "feat(photos): locatePhoto — a photo's index within a navigation scope"
```

---

### Task 2: `GET /api/photos/locate` endpoint

**Files:**
- Create: `apps/web/src/app/api/photos/locate/route.ts`

- [ ] **Step 1: Implement the route** (thin wrapper; verified by typecheck + the Phase F browser run — route handlers have no unit-test pattern in this repo)

```ts
// apps/web/src/app/api/photos/locate/route.ts
import { NextResponse } from "next/server";
import { withAuth } from "@/lib/with-auth";
import { parseDetailScope } from "@/lib/photo-detail-loader";
import { locatePhoto } from "@/lib/locate-photo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Resolve a photo id to its absolute index within a navigation scope, so the
// client can open the lightbox at the right grid position. Read-only.
export const GET = withAuth(async (request) => {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id is required" }, { status: 400 });
  }
  const scope = parseDetailScope({
    album: searchParams.getAll("album"),
    q: searchParams.get("q") ?? undefined,
    s: searchParams.get("s") ?? undefined,
    sort: searchParams.get("sort") ?? undefined,
  });
  const index = await locatePhoto(id, scope);
  if (index === null) {
    return NextResponse.json({ error: "Not found in scope" }, { status: 404 });
  }
  return NextResponse.json({ index });
});
```

> `parseDetailScope` (`photo-detail-loader.ts:25`) expects `album?: string | string[]`; passing the `getAll("album")` array matches the search route's pattern (`api/search/route.ts:14`).

- [ ] **Step 2: Lint + typecheck**

Run: `pnpm --filter @lumio/web lint && pnpm --filter @lumio/web exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/api/photos/locate/route.ts
git commit -m "feat(api): GET /api/photos/locate — photo index within a scope"
```

---

## Phase B — Pure client helpers (TDD)

### Task 3: `collectionForScope` (scope → store source + URLs)

**Files:**
- Create: `apps/web/src/lib/photo-collection-scope.ts`
- Test: `apps/web/src/lib/photo-collection-scope.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/lib/photo-collection-scope.test.ts
import { describe, expect, it } from "vitest";
import { collectionForScope } from "./photo-collection-scope.js";

describe("collectionForScope", () => {
  it("library: /api/photos with sort, base /photos", () => {
    const c = collectionForScope({ kind: "library", sort: "taken-desc" });
    expect(c.endpoint).toBe("/api/photos");
    expect(c.params.get("sort")).toBe("taken-desc");
    expect(c.baseUrl).toBe("/photos");
    expect(c.urlForId("p1")).toBe("/photo/p1"); // default sort omitted in URL
  });

  it("album: scoped endpoint + ?album in the URL", () => {
    const c = collectionForScope({ kind: "album", albumId: "alb1", sort: "imported-asc" });
    expect(c.endpoint).toBe("/api/albums/alb1/photos");
    expect(c.params.get("sort")).toBe("imported-asc");
    expect(c.baseUrl).toBe("/albums/alb1");
    expect(c.urlForId("p1")).toBe("/photo/p1?album=alb1&sort=imported-asc");
  });

  it("search: /api/search with repeated album + q, base /search", () => {
    const c = collectionForScope({ kind: "search", albums: ["a", "b"], q: "cat", sort: "taken-desc" });
    expect(c.endpoint).toBe("/api/search");
    expect(c.params.getAll("album")).toEqual(["a", "b"]);
    expect(c.params.get("q")).toBe("cat");
    expect(c.baseUrl).toBe("/search");
    expect(c.urlForId("p1")).toBe("/photo/p1?s=1&album=a&album=b&q=cat");
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm --filter @lumio/web exec vitest run src/lib/photo-collection-scope.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// apps/web/src/lib/photo-collection-scope.ts
import { type DetailScope, detailScopeQuery } from "@/lib/photo-detail-loader";

export interface CollectionSource {
  /** List API the shared store paginates. */
  endpoint: string;
  /** Query params for that list API (matches what the grid views already send). */
  params: URLSearchParams;
  /** Detail URL for a photo id, carrying the scope (for pushState/replaceState). */
  urlForId: (id: string) => string;
  /** Grid URL to return to when the lightbox closes from a deep link. */
  baseUrl: string;
}

/**
 * Derive the shared store's endpoint/params, the per-photo detail URL, and the
 * grid URL for a navigation scope. Used by the deep-link route (which has no grid
 * view to borrow from). `urlForId` reuses `detailScopeQuery`, the one place the
 * ?album/?s/?q/?sort convention is defined, so URLs match `photoHref`.
 */
export function collectionForScope(scope: DetailScope): CollectionSource {
  const query = detailScopeQuery(scope);
  const urlForId = (id: string) => (query ? `/photo/${id}?${query}` : `/photo/${id}`);

  if (scope.kind === "album") {
    return {
      endpoint: `/api/albums/${scope.albumId}/photos`,
      params: new URLSearchParams({ sort: scope.sort }),
      urlForId,
      baseUrl: `/albums/${scope.albumId}`,
    };
  }
  if (scope.kind === "search") {
    const params = new URLSearchParams();
    for (const a of scope.albums) params.append("album", a);
    if (scope.q) params.set("q", scope.q);
    params.set("sort", scope.sort);
    return { endpoint: "/api/search", params, urlForId, baseUrl: "/search" };
  }
  return {
    endpoint: "/api/photos",
    params: new URLSearchParams({ sort: scope.sort }),
    urlForId,
    baseUrl: "/photos",
  };
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `pnpm --filter @lumio/web exec vitest run src/lib/photo-collection-scope.test.ts`
Expected: PASS (3 tests).

> If the search URL assertion fails on param order, align the test to the exact `detailScopeQuery` output (`photo-detail-loader.ts:41-52`) — that function is the source of truth, not the test's guess.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/photo-collection-scope.ts apps/web/src/lib/photo-collection-scope.test.ts
git commit -m "feat(photos): collectionForScope — store source + URLs for a scope"
```

---

### Task 4: `useImageLoaded` (fixes the stuck-blur cached-onLoad race)

**Files:**
- Create: `apps/web/src/lib/use-image-loaded.ts`
- Test: `apps/web/src/lib/use-image-loaded.test.ts`

- [ ] **Step 1: Write the failing test** (pure predicate only — the hook wiring is DOM and verified in Phase F)

```ts
// apps/web/src/lib/use-image-loaded.test.ts
import { describe, expect, it } from "vitest";
import { imageElementReady } from "./use-image-loaded.js";

describe("imageElementReady", () => {
  it("is false for a null element", () => {
    expect(imageElementReady(null)).toBe(false);
  });

  it("is false while incomplete", () => {
    expect(imageElementReady({ complete: false, naturalWidth: 0 })).toBe(false);
  });

  it("is false when complete but broken (naturalWidth 0)", () => {
    expect(imageElementReady({ complete: true, naturalWidth: 0 })).toBe(false);
  });

  it("is true when complete AND decoded (the cached-image case)", () => {
    expect(imageElementReady({ complete: true, naturalWidth: 1535 })).toBe(true);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm --filter @lumio/web exec vitest run src/lib/use-image-loaded.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// apps/web/src/lib/use-image-loaded.ts
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * True once an <img> has finished loading AND successfully decoded. The
 * `naturalWidth > 0` check distinguishes a genuinely decoded image from a
 * `complete` but broken one. This is the predicate that fixes the stuck blur:
 * a cached image is already `complete` at mount, so `onLoad` may never fire —
 * we must read this synchronously instead of relying on the event.
 */
export function imageElementReady(
  el: { complete: boolean; naturalWidth: number } | null,
): boolean {
  return !!el && el.complete && el.naturalWidth > 0;
}

/**
 * Track whether the image at `src` is loaded, robust to the cached-image race.
 * Returns `{ loaded, ref, onLoad }` to spread onto an <img>. Resets to false when
 * `src` changes; resolves true via the ref callback (catches an already-complete
 * cached image) OR the onLoad event (catches a fresh network load).
 */
export function useImageLoaded(src: string) {
  const [loaded, setLoaded] = useState(false);
  const elRef = useRef<HTMLImageElement | null>(null);

  // Reset whenever the source changes (the persistent <img> swaps photos).
  useEffect(() => {
    setLoaded(imageElementReady(elRef.current) && elRef.current?.currentSrc.length > 0);
  }, [src]);

  const ref = useCallback((node: HTMLImageElement | null) => {
    elRef.current = node;
    if (imageElementReady(node)) setLoaded(true);
  }, []);

  const onLoad = useCallback(() => setLoaded(true), []);

  return { loaded, ref, onLoad };
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `pnpm --filter @lumio/web exec vitest run src/lib/use-image-loaded.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Lint + typecheck, then commit**

```bash
pnpm --filter @lumio/web lint && pnpm --filter @lumio/web exec tsc --noEmit
git add apps/web/src/lib/use-image-loaded.ts apps/web/src/lib/use-image-loaded.test.ts
git commit -m "feat(ui): useImageLoaded — fix stuck blur on cached images"
```

---

### Task 5: `photoIdFromPathname` (popstate URL → photo id)

**Files:**
- Create: `apps/web/src/lib/pathname-photo-id.ts`
- Test: `apps/web/src/lib/pathname-photo-id.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/lib/pathname-photo-id.test.ts
import { describe, expect, it } from "vitest";
import { photoIdFromPathname } from "./pathname-photo-id.js";

describe("photoIdFromPathname", () => {
  it("extracts the id from a /photo/[id] path", () => {
    expect(photoIdFromPathname("/photo/abc123")).toBe("abc123");
  });
  it("ignores a trailing slash", () => {
    expect(photoIdFromPathname("/photo/abc123/")).toBe("abc123");
  });
  it("returns null for non-photo paths", () => {
    expect(photoIdFromPathname("/photos")).toBeNull();
    expect(photoIdFromPathname("/albums/x")).toBeNull();
    expect(photoIdFromPathname("/photo/")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm --filter @lumio/web exec vitest run src/lib/pathname-photo-id.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// apps/web/src/lib/pathname-photo-id.ts
/** The photo id in a `/photo/[id]` pathname, or null if it is not such a path. */
export function photoIdFromPathname(pathname: string): string | null {
  const m = /^\/photo\/([^/]+)\/?$/.exec(pathname);
  return m ? m[1] : null;
}
```

- [ ] **Step 4: Run it, verify it passes**

Run: `pnpm --filter @lumio/web exec vitest run src/lib/pathname-photo-id.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/pathname-photo-id.ts apps/web/src/lib/pathname-photo-id.test.ts
git commit -m "feat(photos): photoIdFromPathname helper for popstate reconciliation"
```

---

### Task 6: Refactor `createHoldStepper` to direction-based navigation

The stepper currently navigates by href (built for the remounting route). For client nav it should step by direction (`prev`/`next`) and ask the target whether a step is possible. The pure state machine and its press-and-hold cadence are kept; only the target shape changes.

**Files:**
- Modify: `apps/web/src/lib/hold-key-nav.ts` (the `HoldTarget` type + `createHoldStepper`; lines 18-98)
- Modify: `apps/web/src/lib/hold-key-nav.test.ts`

- [ ] **Step 1: Update the test to the new target shape**

Replace the `HoldTarget` usage in `hold-key-nav.test.ts`. New `setup` helper and first two tests:

```ts
import { describe, it, expect, vi } from "vitest";
import { createHoldStepper, type HoldTarget } from "./hold-key-nav";

function setup() {
  const step = vi.fn();
  // Simulate a list of 5 photos; `pos` is the current index, advanced by step().
  let pos = 2;
  let tickFn: (() => void) | null = null;
  const target: HoldTarget = {
    canStep: (dir) => (dir === "next" ? pos < 4 : pos > 0),
    step: (dir) => {
      step(dir);
      pos += dir === "next" ? 1 : -1;
    },
  };
  const stepper = createHoldStepper({
    getTarget: () => target,
    schedule: (fn) => {
      tickFn = fn;
      return () => { tickFn = null; };
    },
  });
  return { stepper, step, tick: () => tickFn?.(), isScheduled: () => tickFn !== null };
}

describe("createHoldStepper", () => {
  it("steps once immediately on press and schedules repeats", () => {
    const s = setup();
    s.stepper.press("next");
    expect(s.step).toHaveBeenCalledTimes(1);
    expect(s.step).toHaveBeenLastCalledWith("next");
    expect(s.isScheduled()).toBe(true);
  });

  it("keeps stepping while held and stops at the end of the list", () => {
    const s = setup(); // starts at index 2 of 0..4
    s.stepper.press("next"); // 2 -> 3
    s.tick();                // 3 -> 4
    s.tick();                // at end: canStep('next') is false, no further step
    s.tick();
    expect(s.step).toHaveBeenCalledTimes(2);
  });

  it("release stops the loop", () => {
    const s = setup();
    s.stepper.press("next");
    s.stepper.release("next");
    expect(s.isScheduled()).toBe(false);
  });
});
```

- [ ] **Step 2: Run it, verify it fails**

Run: `pnpm --filter @lumio/web exec vitest run src/lib/hold-key-nav.test.ts`
Expected: FAIL — `canStep` not on `HoldTarget`; `navigate` removed.

- [ ] **Step 3: Rewrite the type + state machine (keep cadence)**

In `hold-key-nav.ts`, replace the `HoldTarget` type (lines 20-25) and `createHoldStepper` body's `step` closure. New definitions:

```ts
export type HoldDirection = "prev" | "next";

export type HoldTarget = {
  /** Whether a step in this direction is currently possible (not at an edge). */
  canStep: (dir: HoldDirection) => boolean;
  /** Advance one photo in `dir` (client state change). */
  step: (dir: HoldDirection) => void;
};
```

Replace the `step`/`stop`/return block (lines 56-97) with the direction-based version (drop the `lastHref` href guard — client steps are synchronous, so there is no in-flight remount to dedupe):

```ts
  let dir: HoldDirection | null = null;
  let cancel: (() => void) | null = null;

  const tick = () => {
    if (!dir) return;
    const target = getTarget();
    if (!target || !target.canStep(dir)) return;
    target.step(dir);
  };

  const stop = () => {
    dir = null;
    if (cancel) { cancel(); cancel = null; }
  };

  return {
    press(next) {
      if (dir === next) return;
      dir = next;
      tick();
      if (cancel) cancel();
      cancel = schedule(tick);
    },
    release(which) {
      if (dir === which) stop();
    },
    stop,
    held: () => dir,
  };
```

Then **delete the DOM-singleton section** (lines 100-161: `target`, `stepper`, `directionForKey`, `ensureWired`, `setHoldNavTarget`). The keydown/keyup wiring moves into the Lightbox (Task 12). Keep `HOLD_STEP_MS`, `HoldDirection`, `HoldTarget`, `HoldStepperOptions`, `HoldStepper`, `createHoldStepper`.

- [ ] **Step 4: Run it, verify it passes**

Run: `pnpm --filter @lumio/web exec vitest run src/lib/hold-key-nav.test.ts`
Expected: PASS.

> Typecheck will now FAIL in `photo-detail.tsx` (uses `setHoldNavTarget`). That's expected — it is removed in Task 17. Do not fix it here; this task's gate is the unit test only.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/hold-key-nav.ts apps/web/src/lib/hold-key-nav.test.ts
git commit -m "refactor(nav): hold stepper steps by direction, not href"
```

---

## Phase C — Shared store + provider + grid

### Task 7: `PhotoCollectionProvider` + context

**Files:**
- Create: `apps/web/src/components/photo-grid/photo-collection.tsx`

This lifts `usePhotoPages` and adds lightbox state, History-API URL sync, neighbor preloading, and popstate reconciliation. No new testable pure logic (its helpers are already tested); gate is typecheck/lint + Phase F.

- [ ] **Step 1: Implement the provider**

```tsx
// apps/web/src/components/photo-grid/photo-collection.tsx
"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PhotoDTO } from "@lumio/shared";
import { PHOTO_PAGE_SIZE } from "@/lib/grid-layout";
import { photoIdFromPathname } from "@/lib/pathname-photo-id";
import { usePhotoPages } from "./use-photo-pages";

/** How far around the open photo to keep loaded (neighbors + film strip). */
const LIGHTBOX_WINDOW = PHOTO_PAGE_SIZE;
/** Neighbors whose /display image we warm so arrow-nav is instant. */
const PRELOAD_RADIUS = 2;

interface PhotoCollectionValue {
  total: number | null;
  photoAt: (index: number) => PhotoDTO | undefined;
  getLoadedIds: () => string[];
  ensureRange: (start: number, end: number) => void;
  patchPhotos: (ids: Set<string>, patch: Partial<PhotoDTO>) => void;
  removePhotos: (ids: Set<string>) => void;
  error: boolean;
  retry: () => void;
  // Lightbox
  enableLightbox: boolean;
  openIndex: number | null;
  open: (index: number) => void;
  close: () => void;
  step: (delta: 1 | -1) => void;
  urlForId: (id: string) => string;
}

const Ctx = createContext<PhotoCollectionValue | null>(null);

export function usePhotoCollection(): PhotoCollectionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePhotoCollection must be used within PhotoCollectionProvider");
  return v;
}

export function PhotoCollectionProvider({
  endpoint = "/api/photos",
  params,
  urlForId,
  baseUrl,
  enableLightbox = true,
  initialIndex = null,
  initialPhoto = null,
  children,
}: {
  endpoint?: string;
  params?: URLSearchParams;
  /** Detail URL for a photo id (carries scope). Required when enableLightbox. */
  urlForId?: (id: string) => string;
  /** Grid URL to restore on close from a deep link. */
  baseUrl?: string;
  enableLightbox?: boolean;
  initialIndex?: number | null;
  initialPhoto?: PhotoDTO | null;
  children: React.ReactNode;
}) {
  const store = usePhotoPages(endpoint, params, PHOTO_PAGE_SIZE);
  const [openIndex, setOpenIndex] = useState<number | null>(initialIndex);
  // True once we've pushed a history entry for the lightbox this session, so
  // close() can pop it (restoring grid scroll) rather than replacing the URL.
  const pushed = useRef(false);
  const url = useCallback((id: string) => (urlForId ? urlForId(id) : `/photo/${id}`), [urlForId]);

  const photoAt = store.photoAt;
  // On a deep link the store page for initialIndex hasn't loaded yet — serve the
  // SSR'd photo as a fallback for exactly that index until the page arrives.
  const photoForIndex = useCallback(
    (index: number): PhotoDTO | undefined => {
      const fromStore = photoAt(index);
      if (fromStore) return fromStore;
      if (initialPhoto && index === initialIndex) return initialPhoto;
      return undefined;
    },
    [photoAt, initialPhoto, initialIndex],
  );

  const ensureRange = store.ensureRange;
  // Keep the window around the open photo loaded.
  useEffect(() => {
    if (openIndex === null) return;
    ensureRange(openIndex - LIGHTBOX_WINDOW, openIndex + LIGHTBOX_WINDOW);
  }, [openIndex, ensureRange]);

  // Warm neighbor /display images.
  useEffect(() => {
    if (openIndex === null) return;
    for (let d = 1; d <= PRELOAD_RADIUS; d++) {
      for (const i of [openIndex + d, openIndex - d]) {
        const p = photoForIndex(i);
        if (p) {
          const img = new Image();
          img.src = `/api/photos/${p.id}/display`;
        }
      }
    }
  }, [openIndex, photoForIndex]);

  // Keep the address bar on the current photo. Also covers the post-trash shift,
  // where the index is unchanged but the photo at it changes (photoForIndex's
  // identity changes when the store mutates). open() creates the history entry;
  // this only ever *replaces*, so it never stacks entries or fires an RSC fetch.
  useEffect(() => {
    if (openIndex === null || typeof window === "undefined") return;
    const p = photoForIndex(openIndex);
    if (p) window.history.replaceState(null, "", url(p.id));
  }, [openIndex, photoForIndex, url]);

  const open = useCallback(
    (index: number) => {
      if (!enableLightbox) return;
      const p = photoForIndex(index);
      setOpenIndex(index);
      if (p && typeof window !== "undefined") {
        window.history.pushState(null, "", url(p.id));
        pushed.current = true;
      }
    },
    [enableLightbox, photoForIndex, url],
  );

  const step = useCallback(
    (delta: 1 | -1) => {
      setOpenIndex((cur) => {
        if (cur === null) return cur;
        const total = store.total ?? 0;
        const next = cur + delta;
        if (next < 0 || next >= total) return cur;
        return next;
      });
    },
    [store.total],
  );

  const close = useCallback(() => {
    if (typeof window !== "undefined" && pushed.current) {
      pushed.current = false;
      window.history.back(); // pops the pushed entry → popstate closes + restores scroll
      return;
    }
    if (typeof window !== "undefined" && baseUrl) {
      window.history.replaceState(null, "", baseUrl);
    }
    setOpenIndex(null);
  }, [baseUrl]);

  // Reconcile browser back/forward with open state.
  useEffect(() => {
    if (!enableLightbox || typeof window === "undefined") return;
    const onPop = () => {
      const id = photoIdFromPathname(window.location.pathname);
      if (!id) {
        pushed.current = false;
        setOpenIndex(null);
        return;
      }
      // Find the id among loaded pages; if absent (deep history jump), fall back
      // to a locate fetch so we land on the right index.
      const loaded = storeIndexOfId(store, id);
      if (loaded !== null) {
        setOpenIndex(loaded);
      } else {
        void fetchLocateIndex(url, id).then((idx) => idx !== null && setOpenIndex(idx));
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [enableLightbox, store, url]);

  const value = useMemo<PhotoCollectionValue>(
    () => ({
      total: store.total,
      photoAt: photoForIndex,
      getLoadedIds: store.getLoadedIds,
      ensureRange: store.ensureRange,
      patchPhotos: store.patchPhotos,
      removePhotos: store.removePhotos,
      error: store.error,
      retry: store.retry,
      enableLightbox,
      openIndex,
      open,
      close,
      step,
      urlForId: url,
    }),
    [store, photoForIndex, enableLightbox, openIndex, open, close, step, url],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Scan loaded pages for an id; null if not currently loaded. */
function storeIndexOfId(store: ReturnType<typeof usePhotoPages>, id: string): number | null {
  const ids = store.getLoadedIds(); // sparse array, index → id
  const idx = ids.indexOf(id);
  return idx === -1 ? null : idx;
}

/** Resolve an unloaded photo's index via the locate endpoint. `url(id)` gives the
 *  detail URL whose query string carries the scope, which locate also accepts. */
async function fetchLocateIndex(url: (id: string) => string, id: string): Promise<number | null> {
  const detail = url(id); // e.g. /photo/<id>?album=..&sort=..
  const qs = detail.includes("?") ? `&${detail.split("?")[1]}` : "";
  try {
    const res = await fetch(`/api/photos/locate?id=${encodeURIComponent(id)}${qs}`);
    if (!res.ok) return null;
    const data = (await res.json()) as { index: number };
    return data.index;
  } catch {
    return null;
  }
}
```

> **Verify** `usePhotoPages` exposes `getLoadedIds` (it does — `use-photo-pages.ts:85,100`). `PHOTO_PAGE_SIZE` is exported from `@/lib/grid-layout` (used in `photo-grid.tsx:6`).

- [ ] **Step 2: Lint + typecheck** (the provider compiles standalone; consumers come next)

Run: `pnpm --filter @lumio/web lint && pnpm --filter @lumio/web exec tsc --noEmit`
Expected: no NEW errors in `photo-collection.tsx` (the pre-existing `photo-detail.tsx` error from Task 6 may still show until Task 17).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/photo-grid/photo-collection.tsx
git commit -m "feat(photos): PhotoCollectionProvider — shared store + lightbox state + URL sync"
```

---

### Task 8: `PhotoGrid` consumes the context; tiles open the lightbox

**Files:**
- Modify: `apps/web/src/components/photo-grid/photo-grid.tsx`
- Modify: `apps/web/src/components/photo-grid/photo-grid-tile.tsx`

- [ ] **Step 1: `PhotoGrid` — read the store from context**

In `photo-grid.tsx`:
- Remove the `usePhotoPages` import (line 17) and its call (lines 74-75).
- Add `import { usePhotoCollection } from "./photo-collection";`.
- Replace lines 74-76 with:

```tsx
  const { total, photoAt, getLoadedIds, ensureRange, error, retry, patchPhotos, removePhotos, open, urlForId, enableLightbox } =
    usePhotoCollection();
  // apiRef stays for back-compat with views that call patch/removePhotos directly.
  useImperativeHandle(apiRef, () => ({ patchPhotos, removePhotos }), [patchPhotos, removePhotos]);
```

- Remove the `endpoint`/`params`/`hrefFor` props from `PhotoGrid`'s signature (now owned by the provider). Keep `mode`, `columns`, `selectMode`, `selectedIds`, `onSelectionChange`, `apiRef`, `empty`. (`sort`/`albumId` are no longer needed since the tile gets `urlForId` from context.)
- In the tile render (lines 198-210), pass `onOpen`:

```tsx
                  <PhotoGridTile
                    key={photo.id}
                    photo={photo}
                    mode={mode}
                    index={idx}
                    onOpen={enableLightbox ? open : undefined}
                    urlForId={urlForId}
                    selectMode={selectMode}
                    isSelected={selectedIds?.has(photo.id) ?? false}
                    onTileClick={handleTileClick}
                  />
```

> The tile's left-click calls `onOpen(index)`; the `href` (for cmd/middle-click) comes from the context `urlForId`. Drop the old `albumId`/`sort`/`hrefFor` plumbing.

- [ ] **Step 2: `PhotoGridTile` — anchor with intercepted left-click**

Replace `photo-grid-tile.tsx` lines 77-85 (the normal-mode `<Link>`) with:

```tsx
  // Real anchor (not next/link → no prefetch). Plain left-click opens the client
  // lightbox; modified clicks (cmd/ctrl/middle/shift) fall through to a real
  // navigation so "open in new tab" still cold-loads the deep-link route.
  return (
    <a
      href={urlForId ? urlForId(photo.id) : photoHref(photo.id, albumId, sort)}
      onClick={(e) => {
        if (!onOpen) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        onOpen(index);
      }}
      className={cn(cellVariants({ mode }), labelHex && "label-mat")}
      style={labelStyle}
    >
      {thumb}
    </a>
  );
```

Update the tile's props type: add `onOpen?: (index: number) => void;` and `urlForId?: (id: string) => string;`; keep `albumId`/`sort` for the fallback href. Keep the `index` prop (already present, line 36).

- [ ] **Step 3: Lint + typecheck**

Run: `pnpm --filter @lumio/web lint && pnpm --filter @lumio/web exec tsc --noEmit`
Expected: errors only in the not-yet-migrated views (they still pass `endpoint`/`params` to `PhotoGrid` and don't wrap it in a provider) and `photo-detail.tsx`. Those are fixed in Tasks 13-17.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/photo-grid/photo-grid.tsx apps/web/src/components/photo-grid/photo-grid-tile.tsx
git commit -m "refactor(grid): consume shared collection store; tiles open the lightbox"
```

---

### Task 9: Extract `useBodyScrollLock` from `route-overlay`

The lightbox needs the same body-pin scroll lock the route overlay used. Extract it so both can share it (the route overlay is deleted in Task 17, but the hook lives on).

**Files:**
- Create: `apps/web/src/lib/use-body-scroll-lock.ts`

- [ ] **Step 1: Implement** (lift the effect body from `route-overlay.tsx:38-75`)

```ts
// apps/web/src/lib/use-body-scroll-lock.ts
import { useEffect } from "react";

/**
 * Pin the body in place while `active`, freezing the window scroll without
 * losing position (the grid uses a window virtualizer, so plain overflow:hidden
 * on the root is unreliable). Pads the locked element by the scrollbar width so
 * centered content doesn't shift on scrollbar removal. Lifted from RouteOverlay.
 */
export function useBodyScrollLock(active: boolean, padRef?: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!active) return;
    const { body } = document;
    const scrollY = window.scrollY;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    const prev = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
    };
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    const padEl = padRef?.current;
    if (scrollbarWidth > 0 && padEl) padEl.style.paddingRight = `${scrollbarWidth}px`;
    return () => {
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.left = prev.left;
      body.style.right = prev.right;
      body.style.width = prev.width;
      window.scrollTo(0, scrollY);
      if (padEl) padEl.style.paddingRight = "";
    };
  }, [active, padRef]);
}
```

- [ ] **Step 2: Lint + typecheck, then commit**

```bash
pnpm --filter @lumio/web lint && pnpm --filter @lumio/web exec tsc --noEmit
git add apps/web/src/lib/use-body-scroll-lock.ts
git commit -m "refactor(ui): extract useBodyScrollLock from RouteOverlay"
```

---

## Phase D — The Lightbox

### Task 10: `Lightbox` shell — image, blur, preload, scroll lock, close

Port the image/blur/container markup from `photo-detail.tsx` into a new client component driven by `usePhotoCollection`. Sidebar, filmstrip, keyboard, and mutations come in Tasks 11-12.

**Files:**
- Create: `apps/web/src/components/photo-grid/lightbox.tsx`

- [ ] **Step 1: Implement the shell**

```tsx
// apps/web/src/components/photo-grid/lightbox.tsx
"use client";

import { useMemo, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { thumbhashDataUrl } from "@/lib/thumbhash-url";
import { useImageLoaded } from "@/lib/use-image-loaded";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import { useBlurBox } from "./use-blur-box"; // extracted below
import { usePhotoCollection } from "./photo-collection";

export function Lightbox() {
  const { openIndex, photoAt, total, step, close } = usePhotoCollection();
  const overlayRef = useRef<HTMLDivElement>(null);
  const photo = openIndex === null ? undefined : photoAt(openIndex);
  useBodyScrollLock(openIndex !== null, overlayRef);

  if (openIndex === null || !photo) return null;

  const hasPrev = openIndex > 0;
  const hasNext = total !== null && openIndex < total - 1;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-y-0 left-[76px] right-0 z-40 overflow-y-auto bg-background lg:bg-background/85 lg:backdrop-blur-xl"
      onClick={(e) => {
        // Click on the backdrop (not a child) closes.
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="flex flex-col lg:h-dvh lg:flex-row">
        <LightboxImage photo={photo} hasPrev={hasPrev} hasNext={hasNext} step={step} />
        {/* Sidebar added in Task 12 */}
      </div>
    </div>
  );
}

function LightboxImage({
  photo,
  hasPrev,
  hasNext,
  step,
}: {
  photo: NonNullable<ReturnType<ReturnType<typeof usePhotoCollection>["photoAt"]>>;
  hasPrev: boolean;
  hasNext: boolean;
  step: (delta: 1 | -1) => void;
}) {
  const src = `/api/photos/${photo.id}/display`;
  const { loaded, ref, onLoad } = useImageLoaded(src);
  const blurUrl = useMemo(() => thumbhashDataUrl(photo.thumbhash), [photo.thumbhash]);
  const { containerRef, imgRef, blurBox } = useBlurBox(photo.width, photo.height, photo.id);

  // Compose the two refs onto the <img> (measure + loaded).
  const setImg = (node: HTMLImageElement | null) => {
    imgRef.current = node;
    ref(node);
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div ref={containerRef} className="relative flex min-h-0 flex-1 items-center justify-center p-4">
        {/* eslint-disable @next/next/no-img-element */}
        {blurUrl && blurBox && (
          <img
            src={blurUrl}
            alt=""
            aria-hidden
            className="pointer-events-none absolute rounded-sm object-cover transition-opacity duration-500"
            style={{ left: blurBox.left, top: blurBox.top, width: blurBox.width, height: blurBox.height, opacity: loaded ? 0 : 1 }}
          />
        )}
        <img
          ref={setImg}
          src={src}
          alt={photo.path}
          width={photo.width}
          height={photo.height}
          onLoad={onLoad}
          className="max-h-[80vh] w-full object-contain lg:max-h-full lg:w-auto lg:max-w-full"
        />
        {/* eslint-enable @next/next/no-img-element */}
        {hasPrev && <NavArrow side="left" label="Previous photo" onClick={() => step(-1)} />}
        {hasNext && <NavArrow side="right" label="Next photo" onClick={() => step(1)} />}
      </div>
    </div>
  );
}

function NavArrow({ side, label, onClick }: { side: "left" | "right"; label: string; onClick: () => void }) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <div className={cn("absolute top-1/2 -translate-y-1/2", side === "left" ? "left-2" : "right-2")}>
      <Button variant="outline" size="icon" className="backdrop-blur" aria-label={label} onClick={onClick}>
        <Icon className="size-5" />
      </Button>
    </div>
  );
}
```

- [ ] **Step 2: Extract `useBlurBox`** (move the measurement effect from `photo-detail.tsx:52-91` verbatim into a hook)

```tsx
// apps/web/src/components/photo-grid/use-blur-box.ts
import { useEffect, useRef, useState } from "react";

export interface BlurBox { left: number; top: number; width: number; height: number; }

/** Measure the visible rectangle of the object-contain image so the blur lands
 *  pixel-perfectly. Ported from the original photo-detail measurement effect. */
export function useBlurBox(width: number, height: number, photoId: string) {
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [blurBox, setBlurBox] = useState<BlurBox | null>(null);
  useEffect(() => {
    const img = imgRef.current;
    const container = containerRef.current;
    if (!img || !container) return;
    const ar = width / height;
    const measure = () => {
      const cw = img.clientWidth;
      const ch = img.clientHeight;
      if (!cw || !ch || !ar) return setBlurBox(null);
      let vw: number, vh: number;
      if (cw / ch > ar) { vh = ch; vw = ch * ar; } else { vw = cw; vh = cw / ar; }
      const ir = img.getBoundingClientRect();
      const cr = container.getBoundingClientRect();
      setBlurBox({ left: ir.left - cr.left + (cw - vw) / 2, top: ir.top - cr.top + (ch - vh) / 2, width: vw, height: vh });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(img);
    ro.observe(container);
    return () => ro.disconnect();
  }, [width, height, photoId]);
  return { containerRef, imgRef, blurBox };
}
```

- [ ] **Step 3: Lint + typecheck**

Run: `pnpm --filter @lumio/web lint && pnpm --filter @lumio/web exec tsc --noEmit`
Expected: no NEW errors in `lightbox.tsx`/`use-blur-box.ts` (pre-existing view/`photo-detail` errors remain until later tasks).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/photo-grid/lightbox.tsx apps/web/src/components/photo-grid/use-blur-box.ts
git commit -m "feat(lightbox): image + blur shell with cached-onLoad fix and preload"
```

---

### Task 11: Film strip reads the shared store

Convert `film-strip.tsx` from href-`<Link>`s to buttons that open by index, and feed it from the store window. Keep all the scroll/fade/scrollbar logic verbatim.

**Files:**
- Modify: `apps/web/src/app/(app)/photo/[id]/film-strip.tsx` → move to `apps/web/src/components/photo-grid/film-strip.tsx`
- Modify: `apps/web/src/components/photo-grid/lightbox.tsx` (render it)

- [ ] **Step 1: Move + adapt the component**

`git mv apps/web/src/app/(app)/photo/[id]/film-strip.tsx apps/web/src/components/photo-grid/film-strip.tsx`. Change the props and the rendered element only:

- Props: replace `items: PhotoStripItem[]; currentId; hrefFor; replace` with:
```tsx
  items: { id: string; index: number }[];
  currentId: string;
  onPick: (index: number) => void;
```
- Replace the `<Link ... href={hrefFor(item.id)} replace={replace} prefetch={false}>` (lines 128-150) with a `<button>`:
```tsx
              <button
                key={item.id}
                ref={active ? (currentRef as React.RefObject<HTMLButtonElement>) : undefined}
                type="button"
                onClick={() => onPick(item.index)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "block size-14 shrink-0 overflow-hidden rounded-xs bg-muted outline-none ring-offset-2 ring-offset-background transition focus-visible:ring-2 focus-visible:ring-primary",
                  active ? "ring-2 ring-primary" : "opacity-80 hover:opacity-100",
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/api/thumbnails/${item.id}`} alt="" loading="lazy" className="h-full w-full object-cover" />
              </button>
```
- Change `currentRef` type from `HTMLAnchorElement` to `HTMLButtonElement` (line 35). Everything else (the `useLayoutEffect` centering, `sync`, drag, mask) stays byte-for-byte.

- [ ] **Step 2: Render it from the Lightbox**

In `lightbox.tsx`, build the strip window from the store and render below the image. Add inside `Lightbox`, before the return, compute the window:

```tsx
  const STRIP_RADIUS = 25;
  const strip = useMemo(() => {
    if (openIndex === null || total === null) return [];
    const lo = Math.max(0, openIndex - STRIP_RADIUS);
    const hi = Math.min(total - 1, openIndex + STRIP_RADIUS);
    const out: { id: string; index: number }[] = [];
    for (let i = lo; i <= hi; i++) {
      const p = photoAt(i);
      if (p) out.push({ id: p.id, index: i });
    }
    return out;
  }, [openIndex, total, photoAt]);
```

And render `{strip.length > 0 && <FilmStrip items={strip} currentId={photo.id} onPick={(i) => open(i)} />}` inside the left column. Pull `open` and `photoAt` from `usePhotoCollection()`. (`open(i)` updates index + URL; works from any index including a jump.)

- [ ] **Step 3: Lint + typecheck, then commit**

```bash
pnpm --filter @lumio/web lint && pnpm --filter @lumio/web exec tsc --noEmit
git add apps/web/src/components/photo-grid/film-strip.tsx apps/web/src/components/photo-grid/lightbox.tsx
git commit -m "feat(lightbox): film strip from the shared store, opens by index"
```

---

### Task 12: Lightbox sidebar, keyboard hold, and store-backed mutations

Port the info/EXIF/album-membership sidebar from `photo-detail.tsx` and wire keyboard navigation + mutations through the store.

**Files:**
- Modify: `apps/web/src/components/photo-grid/lightbox.tsx`
- Create: `apps/web/src/components/photo-grid/lightbox-sidebar.tsx`

- [ ] **Step 1: Keyboard hold + Escape** — add to `Lightbox` an effect using `createHoldStepper`:

```tsx
  const { openIndex, photoAt, total, step, close, ... } = usePhotoCollection();
  // Press-and-hold arrow nav + Escape. No remount now, so the loop lives here.
  const stepRef = useRef(step);
  stepRef.current = step;
  const openRef = useRef(openIndex);
  openRef.current = openIndex;
  const totalRef = useRef(total);
  totalRef.current = total;
  useEffect(() => {
    if (openIndex === null) return;
    const stepper = createHoldStepper({
      getTarget: () => ({
        canStep: (dir) => {
          const i = openRef.current;
          if (i === null) return false;
          return dir === "next" ? totalRef.current !== null && i < totalRef.current - 1 : i > 0;
        },
        step: (dir) => stepRef.current(dir === "next" ? 1 : -1),
      }),
      schedule: (fn) => { const id = setInterval(fn, HOLD_STEP_MS); return () => clearInterval(id); },
    });
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") return close();
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.repeat) return;
      if (e.key === "ArrowLeft") stepper.press("prev");
      else if (e.key === "ArrowRight") stepper.press("next");
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") stepper.release("prev");
      else if (e.key === "ArrowRight") stepper.release("next");
    };
    const onBlur = () => stepper.stop();
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      stepper.stop();
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [openIndex === null, close]); // re-arm only on open/close, not every step
```

Import `createHoldStepper, HOLD_STEP_MS` from `@/lib/hold-key-nav` and `useEffect, useRef`.

- [ ] **Step 2: Sidebar component** — create `lightbox-sidebar.tsx`. Port verbatim from `photo-detail.tsx`: the `<aside>` block (lines 169-212), and the `AlbumMembership` (249-305), `ExifPanel` (307-342), `Row` (344-351) helpers. Change only the data sources:
  - Props: `{ photo: PhotoDTO }` and `onTrashed: () => void`.
  - Compute `filename`, `camera`, `metadata` from `photo` as in `photo-detail.tsx:39-43`.
  - **Album membership**: the store's `photo.albumIds` is undefined for grid-loaded photos. On mount/photo change, fetch it and the album list:
    ```tsx
    const [albumIds, setAlbumIds] = useState<string[] | null>(photo.albumIds ?? null);
    const [regularAlbums, setRegularAlbums] = useState<AlbumSummaryDTO[]>([]);
    useEffect(() => {
      let alive = true;
      void fetch(`/api/photos/${photo.id}`).then((r) => r.ok ? r.json() : null)
        .then((d: PhotoDTO | null) => { if (alive && d) setAlbumIds(d.albumIds ?? []); });
      return () => { alive = false; };
    }, [photo.id]);
    useEffect(() => {
      void fetch("/api/albums").then((r) => r.ok ? r.json() : []).then((a: AlbumSummaryDTO[]) => setRegularAlbums(a.filter((x) => !x.isSmart)));
    }, []);
    ```
  - The album toggle: keep the POST/DELETE to `/api/albums/[id]/photos` (lines 263-273), but instead of `router.refresh()`, update local `albumIds` state and the shared store via `patchPhotos(new Set([photo.id]), { albumIds: nextIds })` from `usePhotoCollection()`.
  - **Download** link (lines 198-203): unchanged (`<a href={/api/photos/${photo.id}/original?download=1}>`).
  - **Delete** (`DeletePhotoButton`, line 204): replace with a button that trashes via the store. See Step 3.

- [ ] **Step 3: Store-backed delete** — in the sidebar, replace `<DeletePhotoButton>` with a button calling:

```tsx
  const { removePhotos } = usePhotoCollection();
  async function trash() {
    const ok = await confirm({ title: "Move to Trash?", description: "You can restore it later.", confirmLabel: "Move to Trash", destructive: true });
    if (!ok) return;
    const res = await fetch("/api/photos/trash", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: [photo.id] }) });
    if (!res.ok) { toast.error("Failed to move to Trash."); return; }
    removePhotos(new Set([photo.id]));
    onTrashed(); // Lightbox: step to next or close
  }
```

Use `useConfirm()` (`@/components/confirm-dialog`) and `toast` from `sonner`, matching `library-view.tsx:35-62`.

In `Lightbox`, pass `onTrashed` (defined in the component's render scope, so `openIndex`/`total` are the pre-delete snapshot — `removePhotos` re-renders asynchronously):
```tsx
  const onTrashed = () => {
    // Were we on the last photo? Then close. Otherwise stay: the store re-indexes
    // (pages at/after the removed one evict and refetch), so the same index now
    // shows what was the next photo, and the provider's URL-sync effect updates
    // the address bar to it. Nothing else to do.
    if (openIndex === null || total === null || openIndex >= total - 1) close();
  };
```

Render `<LightboxSidebar photo={photo} onTrashed={onTrashed} />` in the `Lightbox`'s row (replacing the Task 10 comment).

- [ ] **Step 4: Lint + typecheck**

Run: `pnpm --filter @lumio/web lint && pnpm --filter @lumio/web exec tsc --noEmit`
Expected: no NEW errors in lightbox files.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/photo-grid/lightbox.tsx apps/web/src/components/photo-grid/lightbox-sidebar.tsx
git commit -m "feat(lightbox): sidebar, keyboard hold-nav, store-backed album/trash mutations"
```

---

## Phase E — Wire the views, deep-link route, and remove the old path

### Task 13: Library view → provider + lightbox

**Files:**
- Modify: `apps/web/src/app/(app)/photos/library-view.tsx`

- [ ] **Step 1: Wrap the grid + render the lightbox**

Add imports:
```tsx
import { PhotoCollectionProvider } from "@/components/photo-grid/photo-collection";
import { Lightbox } from "@/components/photo-grid/lightbox";
import { photoHref } from "@/lib/photo-href";
```
Replace the `<PhotoGrid key={sort} apiRef=... endpoint(default) params sort .../>` (lines 155-165) with:
```tsx
      <PhotoCollectionProvider
        key={sort}
        endpoint="/api/photos"
        params={new URLSearchParams({ sort })}
        urlForId={(id) => photoHref(id, undefined, sort)}
        baseUrl="/photos"
      >
        <PhotoGrid
          apiRef={gridRef}
          mode={mode}
          columns={columns}
          selectMode={sel.selectMode}
          selectedIds={sel.selected}
          onSelectionChange={sel.setSelected}
        />
        <Lightbox />
      </PhotoCollectionProvider>
```
> The `key={sort}` moves from `PhotoGrid` to the provider so a sort change rebuilds the store and closes any open lightbox (per spec). `apiRef` still works because `PhotoGrid` exposes the imperative handle from the context's `patchPhotos`/`removePhotos`.

- [ ] **Step 2: Lint + typecheck**

Run: `pnpm --filter @lumio/web lint && pnpm --filter @lumio/web exec tsc --noEmit`
Expected: library view compiles; album/search/trash/photo-detail still error (next tasks).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/(app)/photos/library-view.tsx
git commit -m "feat(library): client lightbox over the shared store"
```

---

### Task 14: Album view → provider + lightbox

**Files:**
- Modify: `apps/web/src/app/(app)/albums/[id]/album-view.tsx`

- [ ] **Step 1: Wrap the grid (lines 206-230)** in a provider mirroring Task 13, with album scope:

```tsx
      <PhotoCollectionProvider
        key={`${reloadKey}:${sort}`}
        endpoint={`/api/albums/${albumId}/photos`}
        params={new URLSearchParams({ sort })}
        urlForId={(id) => photoHref(id, albumId, sort)}
        baseUrl={`/albums/${albumId}`}
      >
        <PhotoGrid
          mode={mode}
          columns={columns}
          selectMode={sel.selectMode}
          selectedIds={sel.selected}
          onSelectionChange={sel.setSelected}
          empty={/* keep the existing <Empty> block */}
        />
        <Lightbox />
      </PhotoCollectionProvider>
```
Add the same three imports as Task 13. The album view's bulk actions use `router.refresh()` + `reloadKey`; leave them (they remount the provider via `key`).

- [ ] **Step 2: Lint + typecheck, commit**

```bash
pnpm --filter @lumio/web lint && pnpm --filter @lumio/web exec tsc --noEmit
git add apps/web/src/app/(app)/albums/[id]/album-view.tsx
git commit -m "feat(albums): client lightbox over the shared store"
```

---

### Task 15: Search view → provider + lightbox

**Files:**
- Modify: `apps/web/src/app/(app)/search/search-view.tsx`

- [ ] **Step 1: Wrap the grid (lines 256-268)** with the search scope. The view already has `paramsFor(filters, sort)` and `scopeQuery(filters, sort)`:

```tsx
      <PhotoCollectionProvider
        key={`${serialized}:${sort}`}
        endpoint="/api/search"
        params={paramsFor(filters, sort)}
        urlForId={(id) => `/photo/${id}?${scopeQuery(filters, sort)}`}
        baseUrl="/search"
      >
        <PhotoGrid
          apiRef={gridRef}
          mode={mode}
          columns={columns}
          selectMode={sel.selectMode}
          selectedIds={sel.selected}
          onSelectionChange={sel.setSelected}
          empty={<SearchEmpty />}
        />
        <Lightbox />
      </PhotoCollectionProvider>
```
Add imports for `PhotoCollectionProvider` and `Lightbox`.

- [ ] **Step 2: Lint + typecheck, commit**

```bash
pnpm --filter @lumio/web lint && pnpm --filter @lumio/web exec tsc --noEmit
git add apps/web/src/app/(app)/search/search-view.tsx
git commit -m "feat(search): client lightbox over the shared store"
```

---

### Task 16: Trash view → provider (store only, no lightbox)

**Files:**
- Modify: `apps/web/src/app/(app)/trash/trash-view.tsx`

- [ ] **Step 1: Wrap the grid (lines 145-153)** in a provider with `enableLightbox={false}`. Trash is always `selectMode`, so no tile ever opens anything; the provider is only needed because `PhotoGrid` now reads its store from context.

```tsx
import { PhotoCollectionProvider } from "@/components/photo-grid/photo-collection";
// ...
      <PhotoCollectionProvider key={reloadKey} endpoint="/api/trash" enableLightbox={false}>
        <PhotoGrid
          apiRef={gridRef}
          selectMode
          selectedIds={sel.selected}
          onSelectionChange={sel.setSelected}
          empty={TRASH_EMPTY}
        />
      </PhotoCollectionProvider>
```
No `<Lightbox/>`, no `urlForId`/`baseUrl`.

- [ ] **Step 2: Lint + typecheck, commit**

```bash
pnpm --filter @lumio/web lint && pnpm --filter @lumio/web exec tsc --noEmit
git add apps/web/src/app/(app)/trash/trash-view.tsx
git commit -m "feat(trash): grid reads shared store; no detail view (unchanged behavior)"
```

---

### Task 17: Deep-link route + remove the intercepting route / old detail

**Files:**
- Modify: `apps/web/src/app/(app)/photo/[id]/page.tsx`
- Delete: `apps/web/src/app/(app)/@modal/(.)photo/[id]/page.tsx` (and the now-empty `@modal` tree)
- Modify: `apps/web/src/app/(app)/layout.tsx`
- Delete: `apps/web/src/app/(app)/photo/[id]/photo-detail.tsx`
- Delete: `apps/web/src/app/(app)/photo/[id]/delete-photo-button.tsx` (folded into the sidebar; confirm no other importers first)
- Delete: `apps/web/src/components/route-overlay.tsx`

- [ ] **Step 1: Rewrite the deep-link route** to SSR the photo + locate index and pre-open the lightbox:

```tsx
// apps/web/src/app/(app)/photo/[id]/page.tsx
import { notFound } from "next/navigation";
import { parseDetailScope } from "@/lib/photo-detail-loader";
import { getPhoto } from "@/lib/photos-service";
import { locatePhoto } from "@/lib/locate-photo";
import { collectionForScope } from "@/lib/photo-collection-scope";
import { PhotoCollectionProvider } from "@/components/photo-grid/photo-collection";
import { PhotoGrid } from "@/components/photo-grid/photo-grid";
import { Lightbox } from "@/components/photo-grid/lightbox";

export const dynamic = "force-dynamic";

export default async function PhotoPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ album?: string | string[]; q?: string; s?: string; sort?: string }>;
}) {
  const { id } = await params;
  const scope = parseDetailScope(await searchParams);
  const [photo, index] = await Promise.all([getPhoto(id), locatePhoto(id, scope)]);
  if (!photo || index === null) notFound();
  const source = collectionForScope(scope);

  return (
    <main className="w-full px-6 pb-6">
      <PhotoCollectionProvider
        endpoint={source.endpoint}
        params={source.params}
        urlForId={source.urlForId}
        baseUrl={source.baseUrl}
        initialIndex={index}
        initialPhoto={photo}
      >
        {/* Grid renders behind the lightbox; closing lands here scrolled into place. */}
        <PhotoGrid />
        <Lightbox />
      </PhotoCollectionProvider>
    </main>
  );
}
```
> `PhotoGrid` here uses defaults (no select mode). It needs `mode`/`columns` to look right; pass the user's persisted grid prefs if desired, or sensible defaults (`mode="fill"`, `columns={DEFAULT_COLUMNS}`). Keep it minimal — the grid is behind the overlay.

- [ ] **Step 2: Remove the `@modal` slot** in `layout.tsx`. Replace lines 5-22 so the layout no longer accepts/renders `modal`:

```tsx
export default async function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  return (
    <>
      <AppSidebar />
      <div className="min-h-dvh pl-[76px]">{children}</div>
    </>
  );
}
```

- [ ] **Step 3: Delete the dead files**

```bash
git rm apps/web/src/app/(app)/@modal/(.)photo/[id]/page.tsx
git rm apps/web/src/app/(app)/photo/[id]/photo-detail.tsx
git rm apps/web/src/components/route-overlay.tsx
# Only if unused elsewhere (grep first):
rg -l "delete-photo-button|DeletePhotoButton" apps/web/src
# If the only hit was photo-detail.tsx, also:
git rm apps/web/src/app/(app)/photo/[id]/delete-photo-button.tsx
```
Remove the now-empty `@modal` directory if git leaves it. Verify nothing else imports `RouteOverlay`, `PhotoDetail`, or `setHoldNavTarget`:
```bash
rg -n "RouteOverlay|photo-detail|setHoldNavTarget|@modal" apps/web/src
```
Expected: no remaining references (the `film-strip` import moved in Task 11).

- [ ] **Step 4: Lint + typecheck**

Run: `pnpm --filter @lumio/web lint && pnpm --filter @lumio/web exec tsc --noEmit`
Expected: **clean** — this is the first point the whole app typechecks again.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(photos): deep-link route pre-opens client lightbox; remove intercepting route"
```

---

### Task 18: Kill the residual prefetch storm

**Files:**
- Modify: `apps/web/src/components/sidebar-nav-link.tsx`

- [ ] **Step 1: Disable prefetch on the sidebar nav** — in `NavLink` (`sidebar-nav-link.tsx:30`), add `prefetch={false}` to the `<Link>` (before `{...props}` so callers can still override):

```tsx
    <Link
      href={item.href}
      prefetch={false}
      aria-current={active ? "page" : undefined}
      title={item.label}
      className={cn(/* unchanged */)}
      {...props}
    >
```

> The `<SidebarAlbums>` flyout trigger (`/albums`) is the other prefetcher; if it renders a `<Link>`, add `prefetch={false}` there too. Grep: `rg -n "Link" apps/web/src/components/sidebar-albums.tsx`.

- [ ] **Step 2: Lint + typecheck, commit**

```bash
pnpm --filter @lumio/web lint && pnpm --filter @lumio/web exec tsc --noEmit
git add apps/web/src/components/sidebar-nav-link.tsx apps/web/src/components/sidebar-albums.tsx
git commit -m "perf(sidebar): disable RSC prefetch to stop the 503 storm on slow servers"
```

---

## Phase F — Full verification

### Task 19: Test suite, build, and browser acceptance

**Files:** none (verification only)

- [ ] **Step 1: Unit tests + lint + typecheck**

Run:
```bash
pnpm --filter @lumio/web test
pnpm --filter @lumio/web lint
pnpm --filter @lumio/web exec tsc --noEmit
```
Expected: all green. New tests from Tasks 1, 3, 4, 5, 6 pass; existing suite unbroken.

- [ ] **Step 2: Production build**

Run: `pnpm --filter @lumio/web build`
Expected: build succeeds; no route at `@modal`; `/photo/[id]` builds as a dynamic route.

- [ ] **Step 3: Browser acceptance** (the regressions that motivated this). Start the DB + dev server (`pnpm db:up` then `pnpm dev`) and drive a browser. Verify each:

  1. **Instant nav, no RSC:** open the grid, click a photo, arrow-key through ~5 photos. In the network panel, **no `…/_rsc…` request fires** during arrow nav (only `/api/photos/[id]/display` and `/api/thumbnails/[id]`).
  2. **Blur never sticks:** navigate to an already-cached photo; the blur overlay's opacity reaches `0` (DOM: the `aria-hidden` blur `<img>` computed `opacity` is `0` once `display` is `complete`). Was stuck at `1` before.
  3. **Neighbor preload:** after opening a photo, `±2` neighbors' `/display` URLs appear in the network panel before navigating to them.
  4. **Deep link:** hard-load `/photo/<id>?sort=imported-desc`; the image shows immediately; the grid is behind; **Esc / sidebar back-arrow** lands on `/photos` scrolled to that photo.
  5. **History:** browser Back closes the lightbox; Back/Forward step through visited photos; the address bar tracks the current photo.
  6. **Trash:** Trash tiles do not open a lightbox (still select-only).
  7. **Mutations:** toggling an album / moving to Trash from the lightbox updates the grid underneath without a full refresh.

- [ ] **Step 4: Final commit (if any verification tweaks were needed)**

```bash
git add -A
git commit -m "test(lightbox): verification fixes"
```

---

## Notes for the implementer

- **Order matters:** Phases A-B build tested foundations; the app does **not** fully typecheck between Task 6 and Task 17 (the old `photo-detail.tsx` references removed APIs). This is intentional and called out per-task. Task 17 is the first clean typecheck.
- **Index alignment is the load-bearing invariant.** `locate` (server), the list endpoints, and the grid store must all order by `photoOrderBy(sort)` over the same `where`. Do not introduce a second ordering. If neighbors looked right before this change, the index will too.
- **Don't reintroduce `<Link>` for photo nav** — every photo step must be client state. The only real navigations left are entering a deep link, leaving via the sidebar, and switching scope/sort.
