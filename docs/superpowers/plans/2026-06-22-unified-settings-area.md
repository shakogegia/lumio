# Unified Settings Area Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Centralize catalog management, per-catalog settings, and the user profile into a single full-page `/settings/*` area with its own sidebar (Account · Catalogs · Users), and make the Catalogs list drag-to-reorder with a persisted order that drives ordering everywhere.

**Architecture:** A new `(app)/settings` route group renders a `SettingsSidebar` and hosts three sections. Account is the relocated Profile. Catalogs is the relocated management list with native HTML5 drag-to-reorder; reorder logic lives in a pure `computeReorder` helper in `@lumio/shared` (backed by `fractional-indexing`) and runs **server-side** — the client only sends "move catalog X after catalog Y". Per-catalog settings become the drill-down `/settings/catalogs/[id]`, loaded by id and wrapped in a `CatalogProvider` so the existing client components keep hitting `/api/c/<slug>/…` unchanged.

**Tech Stack:** Next.js (App Router, RSC), React, TypeScript, Tailwind, shadcn/ui, Prisma (Postgres on :5433), Vitest, `fractional-indexing`.

---

## Background facts (verified against the codebase)

- The per-catalog settings client components (`rescan-button`, `danger-zone`, `refresh-stats-button`, `upload-template-form`) all read `slug` from `useCatalog()` and call `catalogApiUrl(slug, …)` → `/api/c/<slug>/…`. They work unchanged anywhere a `CatalogProvider` wraps them.
- `getCatalogById(id)` already exists in `@lumio/db`.
- `GET /api/catalogs` returns `listCatalogs()` verbatim, so once `listCatalogs` orders by `position` the catalog-switcher flyout reorders for free.
- DB unit tests use small in-memory `fakeDb` mocks and test pure-ish logic only (see `packages/db/src/catalogs.test.ts`). We follow that; the real reorder math is unit-tested in `@lumio/shared` where it is pure.
- New catalogs are created with `position = null`. `listCatalogs` orders `position asc NULLS LAST, then createdAt asc`, so null-position catalogs sort last in `createdAt` order — identical to today's behavior — until the first reorder backfills keys. **No change to `createCatalog` is needed.**
- ⚠️ **Shared dev DB.** All worktrees share one Postgres and other branches' unmerged migrations look like drift, so `prisma migrate dev` will try to **reset** (destructive). Task 2 uses a hand-written migration + `prisma migrate deploy` (which never resets) instead. Never reset/backfill the shared DB.

---

## File structure

**Create:**
- `packages/shared/src/ordering.ts` — pure reorder helper (`computeReorder`) + `fractional-indexing` wrappers.
- `packages/shared/src/ordering.test.ts` — tests.
- `packages/db/prisma/migrations/20260622140000_add_catalog_position/migration.sql` — additive column.
- `apps/web/src/app/(app)/settings/layout.tsx` — settings shell (sidebar + offset).
- `apps/web/src/app/(app)/settings/page.tsx` — redirect to `/settings/catalogs`.
- `apps/web/src/components/settings-sidebar.tsx` — labeled left rail + back-to-photos.

**Move (via `git mv`, preserving history):**
- `apps/web/src/app/(app)/profile/*` → `apps/web/src/app/(app)/settings/account/*`
- `apps/web/src/app/(app)/catalogs/*` → `apps/web/src/app/(app)/settings/catalogs/*`
- `apps/web/src/app/(app)/c/[catalog]/settings/*` → `apps/web/src/app/(app)/settings/catalogs/[id]/*`

**Modify:**
- `packages/shared/src/index.ts` — export `./ordering.js`.
- `packages/shared/package.json` — add `fractional-indexing` dep.
- `packages/db/prisma/schema.prisma` — `Catalog.position String?`.
- `packages/db/src/catalogs.ts` — `listCatalogs` ordering + `applyCatalogPositions`.
- `packages/db/src/users.ts` — `listUsers`.
- `apps/web/src/app/api/catalogs/[id]/route.ts` — accept a reorder op in `PATCH`.
- `apps/web/src/app/(app)/settings/catalogs/catalogs-list.tsx` — add DnD reorder + row links.
- `apps/web/src/app/(app)/settings/catalogs/page.tsx` — drop in-page back link, pass `position` n/a.
- `apps/web/src/app/(app)/settings/catalogs/[id]/page.tsx` — load by id, wrap in `CatalogProvider`, breadcrumb.
- `apps/web/src/app/(app)/settings/account/page.tsx` — title/heading "Account".
- `apps/web/src/components/sidebar-more.tsx` — repoint Profile + Settings links.
- `apps/web/src/components/catalog-switcher.tsx` — repoint "Manage catalogs".

---

## Task 1: `computeReorder` ordering helper in `@lumio/shared`

All fractional-index math lives here as one pure, fully-tested function. Given the catalogs in display order (each with its current `position`, possibly `null`) plus "move `movedId` to sit immediately after `afterId` (or to the front when `afterId` is null)", it returns the minimal set of `{ id, position }` updates to persist — backfilling keys for any `null` positions first.

**Files:**
- Modify: `packages/shared/package.json`
- Create: `packages/shared/src/ordering.ts`
- Create: `packages/shared/src/ordering.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Add the dependency**

Run:
```bash
cd /Users/gego/conductor/workspaces/lumio/daegu
pnpm --filter @lumio/shared add fractional-indexing
```
Expected: `packages/shared/package.json` gains `"fractional-indexing"` under `dependencies` and the lockfile updates.

- [ ] **Step 2: Write the failing test**

Create `packages/shared/src/ordering.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { computeReorder, type OrderedItem } from "./ordering.js";

/** Apply updates onto items and return the resulting id order (sorted by position). */
function orderAfter(items: OrderedItem[], updates: { id: string; position: string }[]): string[] {
  const pos = new Map(items.map((i) => [i.id, i.position]));
  for (const u of updates) pos.set(u.id, u.position);
  return [...pos.entries()]
    .map(([id, position]) => ({ id, position: position as string }))
    .sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0))
    .map((i) => i.id);
}

const keyed: OrderedItem[] = [
  { id: "a", position: "a0" },
  { id: "b", position: "a1" },
  { id: "c", position: "a2" },
];

describe("computeReorder (already-keyed list)", () => {
  it("moves an item to the front when afterId is null", () => {
    const updates = computeReorder(keyed, "c", null);
    expect(orderAfter(keyed, updates)).toEqual(["c", "a", "b"]);
    // Only the moved row changes.
    expect(updates.map((u) => u.id)).toEqual(["c"]);
  });

  it("moves an item to sit after a middle item", () => {
    const updates = computeReorder(keyed, "a", "b"); // a goes after b
    expect(orderAfter(keyed, updates)).toEqual(["b", "a", "c"]);
  });

  it("moves an item to the end", () => {
    const updates = computeReorder(keyed, "a", "c"); // a goes after c (last)
    expect(orderAfter(keyed, updates)).toEqual(["b", "c", "a"]);
  });

  it("is a no-op-equivalent when moved after its current predecessor", () => {
    const updates = computeReorder(keyed, "b", "a"); // b already after a
    expect(orderAfter(keyed, updates)).toEqual(["a", "b", "c"]);
  });
});

describe("computeReorder (backfills null positions)", () => {
  const mixed: OrderedItem[] = [
    { id: "a", position: null },
    { id: "b", position: null },
    { id: "c", position: null },
  ];

  it("assigns keys to every null row and applies the move", () => {
    const updates = computeReorder(mixed, "c", null); // c to front
    // Every row gets a non-empty string key...
    const pos = new Map(updates.map((u) => [u.id, u.position]));
    expect(pos.size).toBe(3);
    for (const v of pos.values()) expect(typeof v).toBe("string");
    // ...and the resulting order honors the move.
    expect(orderAfter(mixed, updates)).toEqual(["c", "a", "b"]);
  });

  it("preserves the order of already-keyed rows when backfilling trailing nulls", () => {
    const partial: OrderedItem[] = [
      { id: "a", position: "a0" },
      { id: "b", position: null },
    ];
    const updates = computeReorder(partial, "a", "b"); // a after b
    expect(orderAfter(partial, updates)).toEqual(["b", "a"]);
  });
});

describe("computeReorder (edge cases)", () => {
  it("returns an empty array for a single-item list moved to front", () => {
    expect(computeReorder([{ id: "a", position: "a0" }], "a", null)).toEqual([]);
  });

  it("throws when movedId is not in the list", () => {
    expect(() => computeReorder(keyed, "zzz", null)).toThrow();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @lumio/shared exec vitest run src/ordering.test.ts`
Expected: FAIL — cannot resolve `./ordering.js` / `computeReorder is not a function`.

- [ ] **Step 4: Implement `computeReorder`**

Create `packages/shared/src/ordering.ts`:

```ts
import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";

/** A row participating in ordering: its id and its current fractional key (or null if unset). */
export interface OrderedItem {
  id: string;
  position: string | null;
}

/** A persisted position change for one row. */
export interface PositionUpdate {
  id: string;
  position: string;
}

/** Generate `count` evenly spaced keys strictly between `before` and `after` (either may be null = open end). */
export function keysBetween(
  before: string | null,
  after: string | null,
  count: number,
): string[] {
  return generateNKeysBetween(before, after, count);
}

/**
 * Compute the position updates needed to move `movedId` so it sits immediately
 * after `afterId` in `items` (afterId === null moves it to the front).
 *
 * `items` MUST already be in display order. Any `null` positions are first
 * backfilled with fractional keys that preserve the current display order
 * (those backfills are included in the returned updates). The moved row then
 * gets a key strictly between its new neighbors. Returns the minimal set of
 * changed rows — usually just the moved row, plus any rows that had to be
 * backfilled.
 *
 * Throws if `movedId` (or a non-null `afterId`) is not present in `items`.
 */
export function computeReorder(
  items: OrderedItem[],
  movedId: string,
  afterId: string | null,
): PositionUpdate[] {
  if (!items.some((i) => i.id === movedId)) {
    throw new Error(`computeReorder: movedId "${movedId}" not found`);
  }
  if (afterId !== null && !items.some((i) => i.id === afterId)) {
    throw new Error(`computeReorder: afterId "${afterId}" not found`);
  }

  // 1) Materialize a fully-keyed view in display order, recording backfills.
  const updates: PositionUpdate[] = [];
  const keyBy: Record<string, string> = {};
  let i = 0;
  while (i < items.length) {
    if (items[i]!.position !== null) {
      keyBy[items[i]!.id] = items[i]!.position as string;
      i += 1;
      continue;
    }
    // Run of consecutive nulls between two keyed anchors (either may be open).
    const before = i > 0 ? keyBy[items[i - 1]!.id]! : null;
    let j = i;
    while (j < items.length && items[j]!.position === null) j += 1;
    const after = j < items.length ? (items[j]!.position as string) : null;
    const fresh = keysBetween(before, after, j - i);
    for (let k = i; k < j; k += 1) {
      keyBy[items[k]!.id] = fresh[k - i]!;
      updates.push({ id: items[k]!.id, position: fresh[k - i]! });
    }
    i = j;
  }

  // 2) Determine the moved row's new neighbors in the order WITHOUT the moved row.
  const order = items.map((it) => it.id).filter((id) => id !== movedId);
  const insertAfter = afterId === null ? -1 : order.indexOf(afterId);
  const beforeKey = insertAfter >= 0 ? keyBy[order[insertAfter]!]! : null;
  const afterKey =
    insertAfter + 1 < order.length ? keyBy[order[insertAfter + 1]!]! : null;
  const newKey = generateKeyBetween(beforeKey, afterKey);

  // 3) Emit the moved row's update (overriding any backfill it may have gotten),
  //    unless the key is unchanged (single-item / already-in-place).
  if (newKey !== keyBy[movedId]) {
    const without = updates.filter((u) => u.id !== movedId);
    without.push({ id: movedId, position: newKey });
    return without;
  }
  return updates.filter((u) => u.id !== movedId);
}
```

- [ ] **Step 5: Export it**

In `packages/shared/src/index.ts`, add after the `./catalogs.js` line:

```ts
export * from "./ordering.js";
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @lumio/shared exec vitest run src/ordering.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/ordering.ts packages/shared/src/ordering.test.ts packages/shared/src/index.ts packages/shared/package.json pnpm-lock.yaml
git commit -m "feat(shared): add computeReorder fractional-index helper"
```

---

## Task 2: Add `Catalog.position` column + order `listCatalogs` + `applyCatalogPositions`

**Files:**
- Modify: `packages/db/prisma/schema.prisma:10-22`
- Create: `packages/db/prisma/migrations/20260622140000_add_catalog_position/migration.sql`
- Modify: `packages/db/src/catalogs.ts`

- [ ] **Step 1: Add the field to the schema**

In `packages/db/prisma/schema.prisma`, inside `model Catalog`, add a `position` field after `uploadTemplate`:

```prisma
model Catalog {
  id             String         @id @default(cuid())
  name           String
  slug           String         @unique
  path           String         @unique
  uploadTemplate String         @default("{YYYY}/{YYYY}-{MM}-{DD}/{filename}")
  position       String?
  createdAt      DateTime       @default(now())
  updatedAt      DateTime       @updatedAt
  photos         Photo[]
  albums         Album[]
  folders        Folder[]
  trashedPhotos  TrashedPhoto[]
}
```

- [ ] **Step 2: Hand-write the migration (do NOT run `migrate dev` — shared DB)**

Create `packages/db/prisma/migrations/20260622140000_add_catalog_position/migration.sql`:

```sql
-- Additive, nullable column for fractional ordering of catalogs.
ALTER TABLE "Catalog" ADD COLUMN "position" TEXT;
```

- [ ] **Step 3: Apply the migration without resetting**

Run:
```bash
cd /Users/gego/conductor/workspaces/lumio/daegu/packages/db
pnpm exec dotenv -e ../../.env -- prisma migrate deploy
```
Expected: `Applying migration 20260622140000_add_catalog_position` then `All migrations have been applied`. (`migrate deploy` applies only pending migrations and never resets, so the shared-DB drift is left untouched.)

- [ ] **Step 4: Regenerate the Prisma client**

Run:
```bash
cd /Users/gego/conductor/workspaces/lumio/daegu
pnpm db:generate
```
Expected: `Generated Prisma Client`. `position` is now on the `Catalog` type.

- [ ] **Step 5: Order `listCatalogs` and add `applyCatalogPositions`**

In `packages/db/src/catalogs.ts`, replace the `listCatalogs` line:

```ts
export function listCatalogs(db: CatalogDb = prisma) {
  return db.catalog.findMany({ orderBy: { createdAt: "asc" } });
}
```

with:

```ts
// Custom order first (fractional `position`), NULLS LAST so un-backfilled rows
// keep createdAt order; createdAt breaks ties. This order drives the management
// list AND the catalog switcher.
export function listCatalogs(db: CatalogDb = prisma) {
  return db.catalog.findMany({
    orderBy: [{ position: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
  });
}

/** Persist a batch of fractional-position updates in one transaction. */
export async function applyCatalogPositions(
  updates: Array<{ id: string; position: string }>,
  db: Pick<PrismaClient, "$transaction" | "catalog"> = prisma,
): Promise<void> {
  if (updates.length === 0) return;
  await db.$transaction(
    updates.map((u) => db.catalog.update({ where: { id: u.id }, data: { position: u.position } })),
  );
}
```

- [ ] **Step 6: Verify the db package typechecks**

Run: `pnpm --filter @lumio/db typecheck`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260622140000_add_catalog_position/migration.sql packages/db/src/catalogs.ts
git commit -m "feat(db): add Catalog.position, order listCatalogs, applyCatalogPositions"
```

---

## Task 3: `listUsers()` for the Users section

**Files:**
- Modify: `packages/db/src/users.ts`
- Create/Modify: `packages/db/src/users.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/db/src/users.test.ts` (create the file if it only has other tests — append a new `describe`):

```ts
import { describe, expect, it } from "vitest";
import { listUsers } from "./users.js";

describe("listUsers", () => {
  it("maps rows to a serializable shape ordered by the query", async () => {
    const rows = [
      {
        id: "u1",
        name: "Ada",
        email: "ada@example.com",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        twoFactorEnabled: true,
      },
    ];
    const db = {
      user: {
        findMany: async (args: unknown) => {
          // The query selects the four columns and orders by createdAt asc.
          expect(args).toMatchObject({
            select: { id: true, name: true, email: true, createdAt: true, twoFactorEnabled: true },
            orderBy: { createdAt: "asc" },
          });
          return rows;
        },
      },
    };
    const result = await listUsers(db as never);
    expect(result).toEqual(rows);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @lumio/db exec vitest run src/users.test.ts`
Expected: FAIL — `listUsers is not a function`.

- [ ] **Step 3: Implement `listUsers`**

Append to `packages/db/src/users.ts`:

```ts
/** A registered user, reduced to the columns the Users list renders. */
export interface UserRow {
  id: string;
  name: string;
  email: string;
  createdAt: Date;
  twoFactorEnabled: boolean;
}

/** Every registered user, oldest first, for the read-only Users settings list. */
export function listUsers(
  db: Pick<PrismaClient, "user"> = prisma,
): Promise<UserRow[]> {
  return db.user.findMany({
    select: { id: true, name: true, email: true, createdAt: true, twoFactorEnabled: true },
    orderBy: { createdAt: "asc" },
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @lumio/db exec vitest run src/users.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/users.ts packages/db/src/users.test.ts
git commit -m "feat(db): add listUsers for the Users settings list"
```

---

## Task 4: Extend `PATCH /api/catalogs/[id]` with a reorder op

The client sends `{ afterId: string | null }` to move this catalog after `afterId` (null = front). The server loads the ordered catalogs, computes updates with `computeReorder`, and persists them. The existing `{ name }` rename path is preserved.

**Files:**
- Modify: `apps/web/src/app/api/catalogs/[id]/route.ts`

- [ ] **Step 1: Rewrite the PATCH handler**

Replace the `PATCH` export in `apps/web/src/app/api/catalogs/[id]/route.ts` with:

```ts
export const PATCH = withAuth(async (request, context: { params: Promise<{ id: string }> }) => {
  const { id } = await context.params;
  const body = (await request.json()) as { name?: string; afterId?: string | null };

  // Reorder: present (even when null) `afterId` means "move after this catalog".
  if ("afterId" in body) {
    const catalogs = await listCatalogs();
    if (!catalogs.some((c) => c.id === id)) {
      return NextResponse.json({ error: "Catalog not found" }, { status: 404 });
    }
    const items = catalogs.map((c) => ({ id: c.id, position: c.position }));
    const updates = computeReorder(items, id, body.afterId ?? null);
    await applyCatalogPositions(updates);
    return NextResponse.json({ ok: true });
  }

  // Rename (unchanged).
  const name = (body.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });
  const catalog = await renameCatalog(id, name);
  return NextResponse.json({ catalog });
});
```

- [ ] **Step 2: Update the imports at the top of the file**

Change the existing import line:

```ts
import { renameCatalog } from "@lumio/db";
```

to:

```ts
import { applyCatalogPositions, listCatalogs, renameCatalog } from "@lumio/db";
import { computeReorder } from "@lumio/shared";
```

- [ ] **Step 3: Verify the web package typechecks**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: no errors (note: full app typecheck; if the project has no `typecheck` script for web, this command still works).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/api/catalogs/[id]/route.ts
git commit -m "feat(api): support catalog reorder in PATCH /api/catalogs/[id]"
```

---

## Task 5: Settings route group shell (layout + sidebar + redirect)

**Files:**
- Create: `apps/web/src/components/settings-sidebar.tsx`
- Create: `apps/web/src/app/(app)/settings/layout.tsx`
- Create: `apps/web/src/app/(app)/settings/page.tsx`

- [ ] **Step 1: Create the `SettingsSidebar` client component**

Create `apps/web/src/components/settings-sidebar.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, GalleryVerticalEnd, User, Users } from "lucide-react";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/settings/account", label: "Account", icon: User },
  { href: "/settings/catalogs", label: "Catalogs", icon: GalleryVerticalEnd },
  { href: "/settings/users", label: "Users", icon: Users },
];

/**
 * Left rail for the settings area. `backHref` is computed server-side (the
 * remembered catalog's photos, or "/") so "Back to photos" returns the user to
 * where they were. Active state matches by path prefix so the Catalogs item
 * stays lit on the per-catalog detail page (`/settings/catalogs/<id>`).
 */
export function SettingsSidebar({ backHref }: { backHref: string }) {
  const pathname = usePathname() ?? "";

  return (
    <aside className="fixed inset-y-0 left-0 z-30 flex h-dvh w-60 flex-col border-r border-border bg-background">
      <div className="px-3 pt-5">
        <Link
          href={backHref}
          className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden />
          Back to photos
        </Link>
        <h2 className="mt-4 px-2 text-lg font-semibold tracking-tight">Settings</h2>
      </div>

      <nav className="mt-4 flex flex-col gap-0.5 px-3">
        {ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              prefetch={false}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
                active
                  ? "bg-muted font-medium text-foreground"
                  : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
            >
              <Icon className="size-[18px]" aria-hidden />
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
```

- [ ] **Step 2: Create the settings layout (RSC)**

Create `apps/web/src/app/(app)/settings/layout.tsx`:

```tsx
import { getDefaultCatalogSlug } from "@/lib/active-catalog";
import { catalogPath } from "@/lib/catalog-api";
import { SettingsSidebar } from "@/components/settings-sidebar";

// Session gating is inherited from (app)/layout.tsx. This layout is
// catalog-agnostic; the per-catalog detail page supplies its own catalog context.
export default async function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const slug = await getDefaultCatalogSlug();
  const backHref = slug ? catalogPath(slug, "/photos") : "/";
  return (
    <>
      <SettingsSidebar backHref={backHref} />
      <div className="min-h-dvh pl-60">{children}</div>
    </>
  );
}
```

- [ ] **Step 3: Create the `/settings` redirect**

Create `apps/web/src/app/(app)/settings/page.tsx`:

```tsx
import { redirect } from "next/navigation";

export default function SettingsIndexPage() {
  redirect("/settings/catalogs");
}
```

- [ ] **Step 4: Commit (sections wired in the next tasks)**

```bash
git add apps/web/src/components/settings-sidebar.tsx "apps/web/src/app/(app)/settings/layout.tsx" "apps/web/src/app/(app)/settings/page.tsx"
git commit -m "feat(web): settings route group shell + sidebar"
```

---

## Task 6: Move Profile → `/settings/account`

**Files:**
- Move: `apps/web/src/app/(app)/profile/*` → `apps/web/src/app/(app)/settings/account/*`
- Modify: `apps/web/src/app/(app)/settings/account/page.tsx`

- [ ] **Step 1: Move the directory (preserves git history; internal relative imports stay valid)**

Run:
```bash
cd /Users/gego/conductor/workspaces/lumio/daegu
git mv "apps/web/src/app/(app)/profile" "apps/web/src/app/(app)/settings/account"
```
Expected: all of `account-form.tsx`, `password-form.tsx`, `two-factor-*.tsx`, `backup-codes.tsx`, `sessions-list.tsx`, `sound-effects-form.tsx`, `parse-user-agent.ts(+test)`, `validate-password-change.ts(+test)`, `page.tsx` now live under `settings/account/`.

- [ ] **Step 2: Rename the page heading + metadata to "Account"**

In `apps/web/src/app/(app)/settings/account/page.tsx`:
- Change `export const metadata: Metadata = { title: "Profile" };` → `export const metadata: Metadata = { title: "Account" };`
- Change `<h1 className="text-2xl font-semibold tracking-tight">Profile</h1>` → `<h1 className="text-2xl font-semibold tracking-tight">Account</h1>`

(Leave the inner `<main className="mx-auto max-w-3xl space-y-8 p-4 py-8">` as-is; it centers inside the `pl-60` offset.)

- [ ] **Step 3: Verify the moved tests still pass**

Run: `pnpm --filter @lumio/web exec vitest run src/app/\(app\)/settings/account`
Expected: PASS (`parse-user-agent` and `validate-password-change` tests run from the new path).

- [ ] **Step 4: Commit**

```bash
git add -A "apps/web/src/app/(app)/settings/account"
git commit -m "refactor(web): move Profile to /settings/account"
```

---

## Task 7: Move Catalogs list → `/settings/catalogs` + drag-to-reorder

**Files:**
- Move: `apps/web/src/app/(app)/catalogs/*` → `apps/web/src/app/(app)/settings/catalogs/*`
- Modify: `apps/web/src/app/(app)/settings/catalogs/page.tsx`
- Modify: `apps/web/src/app/(app)/settings/catalogs/catalogs-list.tsx`

- [ ] **Step 1: Move the directory**

Run:
```bash
cd /Users/gego/conductor/workspaces/lumio/daegu
git mv "apps/web/src/app/(app)/catalogs" "apps/web/src/app/(app)/settings/catalogs"
```
Expected: `page.tsx`, `catalogs-list.tsx`, `rename-catalog-dialog.tsx`, `delete-catalog-dialog.tsx` now under `settings/catalogs/`.

- [ ] **Step 2: Simplify the page (drop the in-page back link — the sidebar owns back nav)**

Replace `apps/web/src/app/(app)/settings/catalogs/page.tsx` with:

```tsx
import type { Metadata } from "next";
import { listCatalogs } from "@lumio/db";
import { getCatalogStats } from "@/lib/status-service";
import { CatalogsList, type CatalogRow } from "./catalogs-list";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Catalogs" };

/**
 * Catalogs management (settings section). Lists every catalog in custom order;
 * rows are drag-reorderable and link into per-catalog settings. This RSC loads
 * catalogs + stats and hands a serializable shape to {@link CatalogsList}.
 */
export default async function CatalogsPage() {
  const catalogs = await listCatalogs();
  const rows: CatalogRow[] = await Promise.all(
    catalogs.map(async (c) => {
      const stats = await getCatalogStats(c.id);
      return {
        id: c.id,
        slug: c.slug,
        name: c.name,
        path: c.path,
        photoCount: stats.photoCount,
      };
    }),
  );

  return (
    <main className="mx-auto max-w-3xl space-y-8 p-4 py-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Catalogs</h1>
        <p className="text-sm text-muted-foreground">
          Each catalog is a separate photo library with its own folder, albums, and edits.
          Drag to reorder.
        </p>
      </div>

      <CatalogsList rows={rows} />
    </main>
  );
}
```

- [ ] **Step 3: Rewrite `CatalogsList` with native drag-to-reorder + row links**

Replace `apps/web/src/app/(app)/settings/catalogs/catalogs-list.tsx` with:

```tsx
"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronRight, Folder, GripVertical, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CreateCatalogDialog } from "@/components/create-catalog-dialog";
import { catalogPath } from "@/lib/catalog-api";
import { RenameCatalogDialog } from "./rename-catalog-dialog";
import { DeleteCatalogDialog } from "./delete-catalog-dialog";

export interface CatalogRow {
  id: string;
  slug: string;
  name: string;
  path: string;
  photoCount: number;
}

function plural(n: number) {
  return n === 1 ? "" : "s";
}

/** Move `id` so it sits immediately after `afterId` (null = front) in a copy of `rows`. */
function moveAfter(rows: CatalogRow[], id: string, afterId: string | null): CatalogRow[] {
  const moved = rows.find((r) => r.id === id);
  if (!moved) return rows;
  const without = rows.filter((r) => r.id !== id);
  const at = afterId === null ? 0 : without.findIndex((r) => r.id === afterId) + 1;
  return [...without.slice(0, at), moved, ...without.slice(at)];
}

/**
 * Client surface for `/settings/catalogs`: a drag-reorderable list (native HTML5
 * DnD), each row linking into per-catalog settings, plus New/Rename/Delete.
 * Reorder is optimistic — we resequence the local array on drop and persist a
 * single "move after X" to the API; on failure we revert to the server order.
 */
export function CatalogsList({ rows }: { rows: CatalogRow[] }) {
  const router = useRouter();
  const [items, setItems] = useState(rows);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<CatalogRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CatalogRow | null>(null);

  // Resync when the server list changes (create/rename/delete/refresh).
  useEffect(() => setItems(rows), [rows]);

  async function persistOrder(next: CatalogRow[], movedId: string) {
    const idx = next.findIndex((r) => r.id === movedId);
    const afterId = idx > 0 ? next[idx - 1]!.id : null;
    try {
      const res = await fetch(`/api/catalogs/${movedId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ afterId }),
      });
      if (!res.ok) throw new Error(String(res.status));
      router.refresh();
    } catch {
      setItems(rows); // revert to server order
      toast.error("Couldn't save the new order");
    }
  }

  function onDragStart(id: string) {
    setDraggingId(id);
  }

  function onDragOverRow(targetId: string) {
    if (!draggingId || draggingId === targetId) return;
    setItems((cur) => {
      const di = cur.findIndex((r) => r.id === draggingId);
      const ti = cur.findIndex((r) => r.id === targetId);
      if (di === -1 || ti === -1) return cur;
      // Place the dragged row immediately before the row it's hovering.
      const afterId = ti > 0 ? cur[ti - 1]!.id : null;
      if (afterId === draggingId) return cur; // already in place
      return moveAfter(cur, draggingId, afterId);
    });
  }

  function onDragEnd() {
    const moved = draggingId;
    setDraggingId(null);
    if (!moved) return;
    // Only persist if the order actually changed vs. the server snapshot.
    const changed = items.some((r, i) => r.id !== rows[i]?.id);
    if (changed) void persistOrder(items, moved);
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setCreateOpen(true)}>
          <Plus data-icon="inline-start" aria-hidden />
          New catalog
        </Button>
      </div>

      <ul className="divide-y divide-border overflow-hidden rounded-2xl bg-muted/40">
        {items.map((row) => (
          <li
            key={row.id}
            draggable
            onDragStart={() => onDragStart(row.id)}
            onDragOver={(e) => {
              e.preventDefault();
              onDragOverRow(row.id);
            }}
            onDragEnd={onDragEnd}
            className={cn(
              "flex items-center gap-3 px-4 py-3.5",
              draggingId === row.id && "opacity-50",
            )}
            data-slot="catalog-row"
          >
            <button
              type="button"
              aria-label={`Drag to reorder ${row.name}`}
              className="cursor-grab text-muted-foreground/60 transition-colors hover:text-foreground active:cursor-grabbing"
              // The whole <li> is draggable; this handle is just the affordance.
              tabIndex={-1}
            >
              <GripVertical className="size-4" aria-hidden />
            </button>

            <Link
              href={`/settings/catalogs/${row.id}`}
              className="flex min-w-0 flex-1 items-center gap-4 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="truncate text-sm font-medium text-foreground">{row.name}</div>
                <code className="block truncate font-mono text-xs text-muted-foreground">
                  {row.path}
                </code>
              </div>
              <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
                {row.photoCount.toLocaleString()} photo{plural(row.photoCount)}
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground/60" aria-hidden />
            </Link>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${row.name}`}>
                  <MoreHorizontal aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setRenameTarget(row)}>
                  <Pencil aria-hidden />
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onSelect={() => setDeleteTarget(row)}>
                  <Trash2 aria-hidden />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </li>
        ))}
        {items.length === 0 && (
          <li className="flex flex-col items-center gap-2 px-4 py-10 text-center text-sm text-muted-foreground">
            <Folder className="size-6 opacity-50" aria-hidden />
            No catalogs yet. Create one to get started.
          </li>
        )}
      </ul>

      <CreateCatalogDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(catalog) => router.push(catalogPath(catalog.slug, "/photos"))}
      />

      <RenameCatalogDialog
        catalog={renameTarget}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null);
        }}
        onRenamed={() => {
          setRenameTarget(null);
          router.refresh();
        }}
      />

      <DeleteCatalogDialog
        catalog={deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        onDeleted={() => {
          setDeleteTarget(null);
          router.refresh();
        }}
      />
    </div>
  );
}
```

> Note: `import { toast } from "sonner"` is the project's toast (same import `use-async-job` uses).

- [ ] **Step 4: Verify typecheck/lint**

Run:
```bash
cd /Users/gego/conductor/workspaces/lumio/daegu
pnpm --filter @lumio/web exec tsc --noEmit && pnpm --filter @lumio/web lint
```
Expected: no errors. (React Compiler lint: state is updated via setItems with an updater fn — compliant.)

- [ ] **Step 5: Commit**

```bash
git add -A "apps/web/src/app/(app)/settings/catalogs"
git commit -m "feat(web): move catalogs to /settings/catalogs with drag-to-reorder"
```

---

## Task 8: Move per-catalog settings → `/settings/catalogs/[id]` (drill-down)

**Files:**
- Move: `apps/web/src/app/(app)/c/[catalog]/settings/*` → `apps/web/src/app/(app)/settings/catalogs/[id]/*`
- Modify: `apps/web/src/app/(app)/settings/catalogs/[id]/page.tsx`

- [ ] **Step 1: Move the directory**

Run:
```bash
cd /Users/gego/conductor/workspaces/lumio/daegu
git mv "apps/web/src/app/(app)/c/[catalog]/settings" "apps/web/src/app/(app)/settings/catalogs/[id]"
```
Expected: `page.tsx`, `danger-zone.tsx`, `rescan-button.tsx`, `refresh-stats-button.tsx`, `upload-template-form.tsx`, `relative-time.tsx` now under `settings/catalogs/[id]/`. The four client components keep their `@/lib/...` absolute imports and continue to call `/api/c/<slug>/…`.

- [ ] **Step 2: Rewrite the detail page to load by id + provide catalog context**

Replace `apps/web/src/app/(app)/settings/catalogs/[id]/page.tsx` with:

```tsx
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { ChevronRight } from "lucide-react";
import { getCatalogById } from "@lumio/db";
import {
  getCatalogStats,
  getPhotoFileCount,
  getStorageSizes,
} from "@/lib/status-service";
import { formatBytes } from "@/lib/format";
import { CatalogProvider } from "@/lib/catalog-context";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InfoList, InfoRow } from "@/components/ui/info-list";
import { DeleteAllPhotos } from "./danger-zone";
import { RefreshStatsButton } from "./refresh-stats-button";
import { RelativeTime } from "./relative-time";
import { RescanButton } from "./rescan-button";
import { UploadTemplateForm } from "./upload-template-form";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Catalog settings" };

/** Count of image files actually on disk; streamed so it never blocks the page. */
async function FilesOnDisk({ catalog }: { catalog: { id: string; path: string } }) {
  const count = await getPhotoFileCount(catalog);
  return <InfoRow label="Files on disk" value={count.toLocaleString()} />;
}

/** On-disk byte sizes (filesystem walk); streamed so they never block the page. */
async function StorageSizes({ catalog }: { catalog: { id: string; path: string } }) {
  const { photosSize, thumbnailsSize, displaysSize, trashSize } = await getStorageSizes(catalog);
  return (
    <>
      <InfoRow label="Photo storage" value={formatBytes(photosSize)} />
      <InfoRow label="Thumbnail cache" value={formatBytes(thumbnailsSize)} />
      <InfoRow label="Preview cache" value={formatBytes(displaysSize)} />
      <InfoRow label="Trash" value={formatBytes(trashSize)} />
    </>
  );
}

export default async function CatalogSettingsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const catalog = await getCatalogById(id);
  if (!catalog) notFound();
  const stats = await getCatalogStats(catalog.id);

  return (
    <CatalogProvider catalog={{ id: catalog.id, slug: catalog.slug, name: catalog.name }}>
      <main className="mx-auto max-w-3xl space-y-8 p-4 py-8">
        <div className="space-y-2">
          <nav className="flex items-center gap-1 text-sm text-muted-foreground">
            <Link href="/settings/catalogs" className="transition-colors hover:text-foreground">
              Catalogs
            </Link>
            <ChevronRight className="size-3.5" aria-hidden />
            <span className="text-foreground">{catalog.name}</span>
          </nav>
          <h1 className="text-2xl font-semibold tracking-tight">{catalog.name}</h1>
        </div>

        <Tabs defaultValue="catalog" className="gap-6">
          <TabsList>
            <TabsTrigger value="catalog">Catalog</TabsTrigger>
            <TabsTrigger value="uploads">Uploads</TabsTrigger>
            <TabsTrigger value="danger">Danger zone</TabsTrigger>
          </TabsList>

          <TabsContent value="catalog" className="space-y-8">
            <InfoList>
              <InfoRow label="Library folder" value={catalog.path} mono />
              <InfoRow label="Photos" value={stats.photoCount.toLocaleString()} />
              <Suspense
                fallback={
                  <InfoRow
                    label="Files on disk"
                    value={<span className="text-muted-foreground">counting…</span>}
                  />
                }
              >
                <FilesOnDisk catalog={catalog} />
              </Suspense>
              <Suspense
                fallback={
                  <>
                    {["Photo storage", "Thumbnail cache", "Preview cache", "Trash"].map((label) => (
                      <InfoRow
                        key={label}
                        label={label}
                        value={<span className="text-muted-foreground">calculating…</span>}
                      />
                    ))}
                  </>
                }
              >
                <StorageSizes catalog={catalog} />
              </Suspense>
              <InfoRow
                label="Last updated"
                value={stats.lastIndexedAt ? <RelativeTime iso={stats.lastIndexedAt} /> : "never"}
              />
            </InfoList>

            <div className="-mt-6 flex justify-end">
              <RefreshStatsButton />
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Indexing</CardTitle>
                <CardDescription>
                  Scan the library for new and deleted files. Existing photos and their edits are
                  left untouched.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <RescanButton />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="uploads">
            <Card>
              <CardHeader>
                <CardTitle>Uploads</CardTitle>
                <CardDescription>
                  Choose the folder structure for newly uploaded photos.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <UploadTemplateForm initial={catalog.uploadTemplate} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="danger">
            <Card>
              <CardHeader>
                <CardTitle>Delete all photos</CardTitle>
                <CardDescription>
                  Remove every photo from the database and filesystem, including cached thumbnails.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <DeleteAllPhotos photoCount={stats.photoCount} />
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </CatalogProvider>
  );
}
```

- [ ] **Step 3: Verify typecheck**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: no errors. (`getCatalogStats`, `getPhotoFileCount`, `getStorageSizes`, `formatBytes`, `InfoList/InfoRow` are the same imports the old page used.)

- [ ] **Step 4: Commit**

```bash
git add -A "apps/web/src/app/(app)/settings/catalogs/[id]" "apps/web/src/app/(app)/c"
git commit -m "feat(web): per-catalog settings become /settings/catalogs/[id] drill-down"
```

---

## Task 9: Users page (read-only list)

The `listUsers()` data function exists (Task 3); this adds the thin RSC table that completes the third sidebar section.

**Files:**
- Create: `apps/web/src/app/(app)/settings/users/page.tsx`

- [ ] **Step 1: Create the Users page**

Create `apps/web/src/app/(app)/settings/users/page.tsx`:

```tsx
import type { Metadata } from "next";
import { listUsers } from "@lumio/db";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Users" };

export default async function UsersPage() {
  const users = await listUsers();
  return (
    <main className="mx-auto max-w-3xl space-y-8 p-4 py-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <p className="text-sm text-muted-foreground">Everyone with an account on this server.</p>
      </div>

      <ul className="divide-y divide-border overflow-hidden rounded-2xl bg-muted/40">
        {users.map((u) => (
          <li key={u.id} className="flex items-center gap-4 px-4 py-3.5">
            <div className="min-w-0 flex-1 space-y-0.5">
              <div className="truncate text-sm font-medium text-foreground">{u.name}</div>
              <div className="truncate text-xs text-muted-foreground">{u.email}</div>
            </div>
            {u.twoFactorEnabled && (
              <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                2FA
              </span>
            )}
            <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
              {u.createdAt.toLocaleDateString()}
            </span>
          </li>
        ))}
        {users.length === 0 && (
          <li className="px-4 py-10 text-center text-sm text-muted-foreground">No users yet.</li>
        )}
      </ul>
    </main>
  );
}
```

- [ ] **Step 2: Verify typecheck**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: no errors (`u.createdAt` is a `Date`, `u.twoFactorEnabled` a `boolean`, per the `UserRow` shape from Task 3).

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/(app)/settings/users/page.tsx"
git commit -m "feat(web): add read-only Users settings list"
```

---

## Task 10: Repoint navigation entry points

**Files:**
- Modify: `apps/web/src/components/sidebar-more.tsx`
- Modify: `apps/web/src/components/catalog-switcher.tsx`

- [ ] **Step 1: Repoint the More menu (`sidebar-more.tsx`)**

We need the current catalog's **id** (not just slug) for the "Settings" deep-link; `useCatalog()` exposes `id`.

Replace the lines computing `settingsHref`/`settingsActive`:

```ts
  const { slug } = useCatalog();
  const { theme, setTheme } = useTheme();
  const settingsHref = catalogPath(slug, "/settings");
  const settingsActive = pathname === settingsHref || pathname.startsWith(`${settingsHref}/`);
```

with:

```ts
  const { id } = useCatalog();
  const { theme, setTheme } = useTheme();
  const settingsHref = `/settings/catalogs/${id}`;
  const settingsActive = pathname.startsWith("/settings");
```

Then change the Profile link target from `/profile` to `/settings/account`:

```tsx
        <DropdownMenuItem asChild>
          <Link href="/settings/account">
            <User aria-hidden />
            Profile
          </Link>
        </DropdownMenuItem>
```

(The existing `<Link href={settingsHref}>` for "Settings" now points to the catalog's drill-down. The `Trash` link still uses `catalogPath(slug, "/trash")` — keep `slug` available by destructuring both: `const { id, slug } = useCatalog();`.)

- [ ] **Step 2: Fix the destructure so both `id` and `slug` are available**

Ensure the hook call reads:

```ts
  const { id, slug } = useCatalog();
```

(`slug` is still used by the Trash `catalogPath(slug, "/trash")` link.)

- [ ] **Step 3: Repoint "Manage catalogs" (`catalog-switcher.tsx`)**

Change the link target:

```tsx
          <Link href="/catalogs" className={rowClass}>
            <Settings2 className="size-4 shrink-0" aria-hidden />
            Manage catalogs
          </Link>
```

to:

```tsx
          <Link href="/settings/catalogs" className={rowClass}>
            <Settings2 className="size-4 shrink-0" aria-hidden />
            Manage catalogs
          </Link>
```

- [ ] **Step 4: Confirm no stale references to the old routes remain**

Run:
```bash
cd /Users/gego/conductor/workspaces/lumio/daegu
grep -rn --include=*.tsx --include=*.ts -E "href=\"/profile\"|href=\"/catalogs\"|catalogPath\([^,]+, ?\"/settings\"" apps/web/src
```
Expected: **no output**. (If anything prints, repoint it to the new path.)

- [ ] **Step 5: Verify typecheck/lint**

Run:
```bash
pnpm --filter @lumio/web exec tsc --noEmit && pnpm --filter @lumio/web lint
```
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/sidebar-more.tsx apps/web/src/components/catalog-switcher.tsx
git commit -m "feat(web): repoint nav to unified /settings area"
```

---

## Task 11: Full verification (build + manual browser check)

**Files:** none (verification only).

- [ ] **Step 1: Run the whole test suite**

Run:
```bash
cd /Users/gego/conductor/workspaces/lumio/daegu
pnpm test
```
Expected: all packages green (notably `@lumio/shared` ordering tests and `@lumio/db` users test).

- [ ] **Step 2: Production build (catches App Router/route issues)**

Run: `pnpm --filter @lumio/web build`
Expected: build succeeds; `/settings`, `/settings/account`, `/settings/catalogs`, `/settings/catalogs/[id]`, `/settings/users` all appear in the route output, and old `/profile`, `/catalogs`, `/c/[catalog]/settings` routes are gone.

- [ ] **Step 3: Manual browser verification (dev server)**

Run `pnpm dev`, then verify in the browser (use the claude-in-chrome tools or by hand):
1. From a catalog, **More → Profile** lands on `/settings/account` with the Account section active in the sidebar.
2. **More → Settings** lands on `/settings/catalogs/<currentId>` (that catalog's settings) with Catalogs active; rescan / upload-template / danger-zone all still work (they call `/api/c/<slug>/…`).
3. **Catalog switcher → Manage catalogs** lands on `/settings/catalogs`.
4. **Drag a catalog** to a new position; it sticks after `router.refresh()`, and the **catalog-switcher flyout** shows the same new order. Reload the page — order persists. (This is the end-to-end check for `listCatalogs` ordering + the reorder API; the fractional math itself is unit-tested in Task 1.)
5. **Sidebar "Back to photos"** returns to the last-used catalog's photos.
6. `/settings/users` lists every user with name, email, joined date, and a 2FA badge where enabled.

---

## Testing approach (why some checks are manual)

- The **reorder math** (`computeReorder`, including null backfill) is the real logic and is fully unit-tested in Task 1 against ordering properties (not exact key strings, so it stays robust to the library's internal alphabet).
- **`listCatalogs` ordering** (`position asc NULLS LAST, then createdAt`) is a Prisma `orderBy` clause that exercises Postgres null-ordering — there is no meaningful unit test without a real DB (the repo's `fakeDb` mocks don't model `orderBy`). It is verified end-to-end by the build + the manual reorder/persist/reload check (Task 11, Step 3.4), matching the repo's existing convention of not mocking Prisma query semantics.
- Page **moves** (Account, Catalogs, drill-down, Users) carry no unit tests in this repo (only pure helpers like `parse-user-agent` and `validate-password-change` are tested); their verification is typecheck + lint + the production build + the manual walkthrough.

---

## Notes on conventions to respect

- **shadcn `ui/*` components are not modified** — compose/copy styles instead (per `lumio-shadcn-components`).
- **React Compiler lint** (per `lumio-react-compiler-lint`): `"use client"` on line 1; update state via `setState` updater fns; don't mutate props/state. The `CatalogsList` rewrite follows this.
- **Migrations on the shared DB**: hand-write SQL + `prisma migrate deploy`; never `migrate dev`/reset/backfill (per `lumio-shared-db-drift`, `lumio-multi-catalog`).
- **Enums**: not introduced here; n/a.
```
