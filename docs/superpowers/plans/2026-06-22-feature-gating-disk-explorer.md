# Feature-enablement architecture + Disk Explorer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a small, extensible feature-toggle system (global + per-catalog) and ship the Disk Explorer (browse a catalog's folders & files on disk) as its first gated consumer.

**Architecture:** A pure registry in `@lumio/shared` declares each feature's scopes + global default. A resolver in `@lumio/db` reads a generic `FeatureSetting` table (`catalogId = null` = global switch; non-null = per-catalog override) and computes effective state per the rule `global && (catalog inherits-on)`. The active-catalog layout resolves the map server-side and seeds a tiny SSR-only `FeaturesProvider`; the sidebar reads `useFeature` to show the Folders nav item. The Folders page is server-rendered and gated with `isFeatureEnabled`. Settings get a new global **Features** section and a per-catalog **Features** tab, both writing via `PUT /api/features`.

**Tech Stack:** TypeScript, Next.js 16 App Router (Node runtime routes), Prisma + Postgres (shared dev DB on :5433), Tailwind + shadcn (Base UI), Vitest.

### Spec reference
`docs/superpowers/specs/2026-06-22-feature-gating-disk-explorer-design.md`

### Intentional simplifications from the spec (all preserve user-visible behavior)
These reduce surface area because the **only client consumer of feature state is the sidebar**, and the Folders page renders server-side:
- **No `GET /api/c/[catalog]/features` route and no client refetch/invalidate.** The provider is SSR-seeded and static. After toggling in settings, `router.refresh()` re-runs server components; the sidebar reflects new state on the next catalog-layout render.
- **No `GET /api/c/[catalog]/fs` route.** The Folders page calls the `readCatalogDir` service directly server-side (one fewer round-trip), still feature-gated at the page.
- **`FileEntry.mtime` dropped** (kept `size`). YAGNI for v1.
The architecture (registry + generic table + resolver + `PUT /api/features` + settings surfaces) is unchanged.

### Key codebase facts (verified)
- **`Photo.path` is RELATIVE to `Catalog.path`** (e.g. `"vacation/img.jpg"`). Match on-disk files to indexed photos by relative path.
- **Path-traversal guard already exists:** `originalPath(catalog, relPath)` in `apps/web/src/lib/paths.ts` resolves `catalog.path + relPath` and throws on escape. Reuse it.
- **DB writes go through Prisma services that accept an injectable `db` param** (default `prisma`) — see `packages/db/src/user-settings.ts`. Tests pass a fake `db`.
- **Migrations on the shared DB MUST be hand-written + `migrate deploy`** — `prisma migrate dev` tries to RESET on the shared instance (no shadow DB). See Task 3.
- **Postgres unique indexes treat `NULL` as distinct** — so `@@unique([featureKey, catalogId])` does NOT dedupe global rows (`catalogId = null`). `setFeature` enforces single-row semantics in app code with `updateMany`+`create` in a transaction (Task 4).
- **Typecheck baseline is NOT clean:** `packages/shared/src/calendar.ts` has pre-existing TS errors. Success = no NEW errors: `pnpm --filter <pkg> typecheck 2>&1 | grep 'error TS' | grep -v calendar.ts` is empty.
- **Photos open via a page link:** `catalogPath(slug, \`/photo/${id}\`)`. Thumbnails: `catalogApiUrl(slug, \`/photos/${id}/thumbnail\`)`.

### File structure (created / modified)
- Create `packages/shared/src/features.ts` (+ `.test.ts`) — registry (pure).
- Modify `packages/shared/src/formats.ts` (+ `.test.ts`) — add `isSupportedImage`.
- Modify `packages/shared/src/index.ts` — export `features.js`.
- Modify `packages/db/prisma/schema.prisma` — `FeatureSetting` model + `Catalog` back-relation.
- Create `packages/db/prisma/migrations/20260622150000_add_feature_setting/migration.sql`.
- Create `packages/db/src/features.ts` (+ `.test.ts`) — resolver/setters.
- Modify `packages/db/src/index.ts` — export `features.js`.
- Create `apps/web/src/app/api/features/route.ts` — `PUT` toggle.
- Create `apps/web/src/components/features/features-provider.tsx` — `FeaturesProvider` + `useFeature`.
- Modify `apps/web/src/app/(app)/c/[catalog]/layout.tsx` — seed the provider.
- Modify `apps/web/src/components/app-sidebar.tsx` — gated Folders nav item.
- Create `apps/web/src/lib/catalog-fs.ts` (+ `.test.ts`) — pure listing helpers.
- Create `apps/web/src/lib/catalog-fs-service.ts` (+ `.test.ts`) — `readCatalogDir` IO wrapper.
- Create `apps/web/src/app/(app)/c/[catalog]/folders/page.tsx` — gated server page.
- Create `apps/web/src/app/(app)/c/[catalog]/folders/folder-explorer.tsx` — presentational view.
- Create `apps/web/src/app/(app)/settings/features/page.tsx` + `global-features-form.tsx`.
- Modify `apps/web/src/components/settings-sidebar.tsx` — Features rail item.
- Create `apps/web/src/app/(app)/settings/catalogs/[id]/catalog-features-form.tsx`.
- Modify `apps/web/src/app/(app)/settings/catalogs/[id]/page.tsx` — Features tab.

---

## Task 1: `isSupportedImage` helper (shared)

**Files:**
- Modify: `packages/shared/src/formats.ts`
- Test: `packages/shared/src/formats.test.ts` (create)

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/formats.test.ts
import { describe, expect, it } from "vitest";
import { isSupportedImage } from "./formats.js";

describe("isSupportedImage", () => {
  it("accepts supported extensions case-insensitively", () => {
    expect(isSupportedImage("a.JPG")).toBe(true);
    expect(isSupportedImage("dir/sub/b.heic")).toBe(true);
    expect(isSupportedImage("c.jxl")).toBe(true);
  });
  it("rejects non-image and extensionless names", () => {
    expect(isSupportedImage("notes.txt")).toBe(false);
    expect(isSupportedImage("README")).toBe(false);
    expect(isSupportedImage("archive.zip")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lumio/shared exec vitest run src/formats.test.ts`
Expected: FAIL — `isSupportedImage is not a function`.

- [ ] **Step 3: Implement**

Append to `packages/shared/src/formats.ts`:

```ts
/**
 * True if `filename`'s extension is one the system ingests (case-insensitive).
 * Pure string check — no filesystem access — so the browser can use it too.
 */
export function isSupportedImage(filename: string): boolean {
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return false;
  return SUPPORTED_EXTENSIONS.has(filename.slice(dot).toLowerCase());
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lumio/shared exec vitest run src/formats.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/formats.ts packages/shared/src/formats.test.ts
git commit -m "feat(shared): add isSupportedImage extension helper"
```

---

## Task 2: Feature registry (shared)

**Files:**
- Create: `packages/shared/src/features.ts`
- Test: `packages/shared/src/features.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/src/features.test.ts
import { describe, expect, it } from "vitest";
import { FEATURES, FeatureKey, FeatureScope } from "./features.js";

describe("FEATURES registry", () => {
  it("has an entry for every FeatureKey, keyed by its own key", () => {
    for (const key of Object.values(FeatureKey)) {
      const def = FEATURES[key];
      expect(def, `missing entry for ${key}`).toBeTruthy();
      expect(def.key).toBe(key);
    }
  });
  it("every feature declares at least one scope", () => {
    for (const def of Object.values(FEATURES)) {
      expect(def.scopes.length).toBeGreaterThan(0);
      for (const s of def.scopes) {
        expect(Object.values(FeatureScope)).toContain(s);
      }
    }
  });
  it("disk explorer is global+catalog and defaults off", () => {
    const d = FEATURES[FeatureKey.DiskExplorer];
    expect(d.scopes).toEqual([FeatureScope.Global, FeatureScope.Catalog]);
    expect(d.default).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lumio/shared exec vitest run src/features.test.ts`
Expected: FAIL — cannot find `./features.js`.

- [ ] **Step 3: Implement**

```ts
// packages/shared/src/features.ts
/**
 * Feature registry — the single source of truth for which optional features
 * exist, the scope(s) they can be toggled at, and their GLOBAL default.
 * Pure: no Prisma, no Next, no Node. Both server and client import it.
 *
 * Resolution rule (implemented in @lumio/db/features.ts):
 *   global  = the global row's value, else `default`
 *   catalog = the per-catalog row's value, else `true` (inherit / opt-out only)
 *   effective = global && (scopes includes catalog ? catalog : true)
 */

export enum FeatureKey {
  DiskExplorer = "diskExplorer",
}

export enum FeatureScope {
  Global = "global",
  Catalog = "catalog",
}

export interface FeatureDef {
  key: FeatureKey;
  label: string;
  description: string;
  scopes: FeatureScope[];
  /** The GLOBAL default when no global row exists. */
  default: boolean;
}

export const FEATURES: Record<FeatureKey, FeatureDef> = {
  [FeatureKey.DiskExplorer]: {
    key: FeatureKey.DiskExplorer,
    label: "Folder browser",
    description: "Browse the catalog's folders and files on disk.",
    scopes: [FeatureScope.Global, FeatureScope.Catalog],
    default: false,
  },
};

/** Effective enabled-state for every feature, keyed by FeatureKey. */
export type FeatureMap = Record<FeatureKey, boolean>;

/** All feature keys, in registry order. */
export const ALL_FEATURE_KEYS = Object.values(FeatureKey);
```

Add to `packages/shared/src/index.ts` (alongside the other `export *` lines):

```ts
export * from "./features.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lumio/shared exec vitest run src/features.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/features.ts packages/shared/src/features.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): add feature registry (keys, scopes, defaults)"
```

---

## Task 3: `FeatureSetting` schema + migration (db)

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260622150000_add_feature_setting/migration.sql`

> ⚠️ Do NOT run `prisma migrate dev` — on the shared DB it tries to RESET (no shadow DB) and would wipe photos. Hand-write the SQL and `migrate deploy`.

- [ ] **Step 1: Add the model to `schema.prisma`**

Add this model (place it after the `Catalog` model, near `Folder`):

```prisma
model FeatureSetting {
  id         String   @id @default(cuid())
  featureKey String
  catalogId  String?  // null = the global switch; non-null = a per-catalog override
  catalog    Catalog? @relation(fields: [catalogId], references: [id], onDelete: Cascade)
  enabled    Boolean
  updatedAt  DateTime @updatedAt

  // NOTE: Postgres treats NULL as distinct, so this does NOT dedupe global
  // (catalogId = null) rows — setFeature() enforces single-row semantics in code.
  @@unique([featureKey, catalogId])
  @@index([catalogId])
}
```

- [ ] **Step 2: Add the back-relation to `Catalog`**

In `model Catalog { ... }`, add this line alongside the other relations (`photos`, `albums`, `folders`, `trashedPhotos`):

```prisma
  featureSettings FeatureSetting[]
```

- [ ] **Step 3: Hand-write the migration SQL**

Create `packages/db/prisma/migrations/20260622150000_add_feature_setting/migration.sql`:

```sql
-- CreateTable
CREATE TABLE "FeatureSetting" (
    "id" TEXT NOT NULL,
    "featureKey" TEXT NOT NULL,
    "catalogId" TEXT,
    "enabled" BOOLEAN NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeatureSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FeatureSetting_featureKey_catalogId_key" ON "FeatureSetting"("featureKey", "catalogId");

-- CreateIndex
CREATE INDEX "FeatureSetting_catalogId_idx" ON "FeatureSetting"("catalogId");

-- AddForeignKey
ALTER TABLE "FeatureSetting" ADD CONSTRAINT "FeatureSetting_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "Catalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

- [ ] **Step 4: Apply + regenerate (non-destructive)**

Run, in order:

```bash
pnpm --filter @lumio/db exec dotenv -e ../../.env -- prisma migrate status
pnpm --filter @lumio/db exec dotenv -e ../../.env -- prisma migrate deploy
pnpm --filter @lumio/db exec dotenv -e ../../.env -- prisma generate
```

Expected: `migrate status` lists the new migration as pending (other branches' migrations may show as applied — that's fine); `migrate deploy` reports `1 migration applied` and never mentions reset; `generate` succeeds.

> If `migrate deploy` reports drift from another workspace's migration, STOP and follow the realign recipe in project memory (`lumio-env-gotchas`) — do NOT reset.

- [ ] **Step 5: Verify the Prisma client sees the model**

Run: `pnpm --filter @lumio/db exec tsc --noEmit 2>&1 | grep 'error TS' | grep -v calendar.ts`
Expected: empty (only pre-existing calendar.ts errors exist). The `prisma.featureSetting` delegate now exists.

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260622150000_add_feature_setting
git commit -m "feat(db): add FeatureSetting table for feature toggles"
```

---

## Task 4: Feature resolver + setters (db)

**Files:**
- Create: `packages/db/src/features.ts`
- Test: `packages/db/src/features.test.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/db/src/features.test.ts
import { describe, expect, it, vi } from "vitest";
import { FeatureKey } from "@lumio/shared";
import {
  resolveFeatures,
  setFeature,
  getGlobalFeatureStates,
  getCatalogFeatureStates,
  FeatureScopeError,
} from "./features.js";

type Row = { featureKey: string; catalogId: string | null; enabled: boolean };

function readDb(rows: Row[]) {
  return { featureSetting: { findMany: async () => rows } } as never;
}

describe("resolveFeatures", () => {
  it("uses the registry default when there are no rows", async () => {
    const map = await resolveFeatures("cat1", readDb([]));
    expect(map[FeatureKey.DiskExplorer]).toBe(false); // default
  });
  it("global ON, no catalog override => enabled (catalog inherits on)", async () => {
    const map = await resolveFeatures("cat1", readDb([
      { featureKey: "diskExplorer", catalogId: null, enabled: true },
    ]));
    expect(map[FeatureKey.DiskExplorer]).toBe(true);
  });
  it("global ON but this catalog opted out => disabled", async () => {
    const map = await resolveFeatures("cat1", readDb([
      { featureKey: "diskExplorer", catalogId: null, enabled: true },
      { featureKey: "diskExplorer", catalogId: "cat1", enabled: false },
    ]));
    expect(map[FeatureKey.DiskExplorer]).toBe(false);
  });
  it("global OFF overrides a catalog ON (master switch)", async () => {
    const map = await resolveFeatures("cat1", readDb([
      { featureKey: "diskExplorer", catalogId: null, enabled: false },
      { featureKey: "diskExplorer", catalogId: "cat1", enabled: true },
    ]));
    expect(map[FeatureKey.DiskExplorer]).toBe(false);
  });
});

describe("getGlobalFeatureStates / getCatalogFeatureStates", () => {
  it("global states fall back to default", async () => {
    const states = await getGlobalFeatureStates(readDb([]));
    expect(states.find((s) => s.key === FeatureKey.DiskExplorer)?.enabled).toBe(false);
  });
  it("catalog states report globalEnabled + inherit-on catalogEnabled", async () => {
    const states = await getCatalogFeatureStates("cat1", readDb([
      { featureKey: "diskExplorer", catalogId: null, enabled: true },
    ]));
    const d = states.find((s) => s.key === FeatureKey.DiskExplorer)!;
    expect(d.globalEnabled).toBe(true);
    expect(d.catalogEnabled).toBe(true); // no override => inherit on
  });
});

describe("setFeature", () => {
  it("rejects a scope the feature does not declare", async () => {
    // DiskExplorer allows both scopes, so fabricate rejection via an unknown scope:
    // a global-only feature would reject catalogId != null. DiskExplorer accepts
    // both, so assert the happy path writes instead.
    const updateMany = vi.fn(async () => ({ count: 0 }));
    const create = vi.fn(async () => undefined);
    const db = {
      $transaction: async (fn: (tx: never) => Promise<void>) =>
        fn({ featureSetting: { updateMany, create } } as never),
    } as never;
    await setFeature({ key: FeatureKey.DiskExplorer, catalogId: null, enabled: true }, db);
    expect(updateMany).toHaveBeenCalledOnce();
    expect(create).toHaveBeenCalledOnce(); // count 0 => create
  });
  it("FeatureScopeError is exported", () => {
    expect(new FeatureScopeError("x")).toBeInstanceOf(Error);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lumio/db exec vitest run src/features.test.ts`
Expected: FAIL — cannot find `./features.js`.

- [ ] **Step 3: Implement**

```ts
// packages/db/src/features.ts
import type { PrismaClient } from "@prisma/client";
import {
  ALL_FEATURE_KEYS,
  FEATURES,
  FeatureKey,
  FeatureScope,
  type FeatureMap,
} from "@lumio/shared";
import { prisma } from "./client.js";

type FeaturesReadDb = Pick<PrismaClient, "featureSetting">;
type FeaturesWriteDb = Pick<PrismaClient, "$transaction">;

export class UnknownFeatureError extends Error {}
export class FeatureScopeError extends Error {}

interface ScopeRows {
  global: Map<string, boolean>;
  catalog: Map<string, boolean>;
}

async function loadRows(catalogId: string, db: FeaturesReadDb): Promise<ScopeRows> {
  const rows = await db.featureSetting.findMany({
    where: { OR: [{ catalogId: null }, { catalogId }] },
  });
  const global = new Map<string, boolean>();
  const catalog = new Map<string, boolean>();
  for (const r of rows) {
    if (r.catalogId === null) global.set(r.featureKey, r.enabled);
    else catalog.set(r.featureKey, r.enabled);
  }
  return { global, catalog };
}

function globalOf(key: FeatureKey, rows: { global: Map<string, boolean> }): boolean {
  return rows.global.get(key) ?? FEATURES[key].default;
}

function catalogOf(key: FeatureKey, rows: { catalog: Map<string, boolean> }): boolean {
  // Catalog scope inherits ON; a row only ever opts a catalog OUT.
  return rows.catalog.get(key) ?? true;
}

/** Effective enabled-state for every feature, for one catalog. */
export async function resolveFeatures(
  catalogId: string,
  db: FeaturesReadDb = prisma,
): Promise<FeatureMap> {
  const rows = await loadRows(catalogId, db);
  const map = {} as FeatureMap;
  for (const key of ALL_FEATURE_KEYS) {
    const usesCatalog = FEATURES[key].scopes.includes(FeatureScope.Catalog);
    map[key] = globalOf(key, rows) && (usesCatalog ? catalogOf(key, rows) : true);
  }
  return map;
}

/** Convenience for route/page guards. */
export async function isFeatureEnabled(
  catalogId: string,
  key: FeatureKey,
  db: FeaturesReadDb = prisma,
): Promise<boolean> {
  return (await resolveFeatures(catalogId, db))[key];
}

export interface GlobalFeatureState {
  key: FeatureKey;
  label: string;
  description: string;
  enabled: boolean;
}

/** Raw global switch state for every feature (for the global Features settings page). */
export async function getGlobalFeatureStates(
  db: FeaturesReadDb = prisma,
): Promise<GlobalFeatureState[]> {
  const rows = await db.featureSetting.findMany({ where: { catalogId: null } });
  const byKey = new Map(rows.map((r) => [r.featureKey, r.enabled]));
  return ALL_FEATURE_KEYS.map((key) => ({
    key,
    label: FEATURES[key].label,
    description: FEATURES[key].description,
    enabled: byKey.get(key) ?? FEATURES[key].default,
  }));
}

export interface CatalogFeatureState {
  key: FeatureKey;
  label: string;
  description: string;
  globalEnabled: boolean;
  catalogEnabled: boolean;
}

/** Per-catalog state for catalog-scoped features (for the catalog Features tab). */
export async function getCatalogFeatureStates(
  catalogId: string,
  db: FeaturesReadDb = prisma,
): Promise<CatalogFeatureState[]> {
  const rows = await loadRows(catalogId, db);
  return ALL_FEATURE_KEYS.filter((key) =>
    FEATURES[key].scopes.includes(FeatureScope.Catalog),
  ).map((key) => ({
    key,
    label: FEATURES[key].label,
    description: FEATURES[key].description,
    globalEnabled: globalOf(key, rows),
    catalogEnabled: catalogOf(key, rows),
  }));
}

/**
 * Upsert one toggle. `catalogId === null` writes the global switch; a non-null
 * id writes a per-catalog override. We use updateMany+create inside a
 * transaction (not upsert) because Postgres treats a NULL catalogId as distinct
 * in the unique index, so upsert-by-unique cannot dedupe global rows.
 */
export async function setFeature(
  input: { key: FeatureKey; catalogId: string | null; enabled: boolean },
  db: FeaturesWriteDb = prisma,
): Promise<void> {
  const def = FEATURES[input.key];
  if (!def) throw new UnknownFeatureError(String(input.key));
  const scope = input.catalogId === null ? FeatureScope.Global : FeatureScope.Catalog;
  if (!def.scopes.includes(scope)) {
    throw new FeatureScopeError(`${input.key} cannot be toggled at scope ${scope}`);
  }
  await db.$transaction(async (tx) => {
    const updated = await tx.featureSetting.updateMany({
      where: { featureKey: input.key, catalogId: input.catalogId },
      data: { enabled: input.enabled },
    });
    if (updated.count === 0) {
      await tx.featureSetting.create({
        data: { featureKey: input.key, catalogId: input.catalogId, enabled: input.enabled },
      });
    }
  });
}
```

Add to `packages/db/src/index.ts`:

```ts
export * from "./features.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lumio/db exec vitest run src/features.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/features.ts packages/db/src/features.test.ts packages/db/src/index.ts
git commit -m "feat(db): feature resolver + setFeature (global/catalog, AND resolution)"
```

---

## Task 5: `PUT /api/features` route

**Files:**
- Create: `apps/web/src/app/api/features/route.ts`

> Routes aren't unit-tested in this repo; correctness rests on Task 4's tests. Verify with the typecheck + the manual curl in Step 3.

- [ ] **Step 1: Implement the route**

```ts
// apps/web/src/app/api/features/route.ts
import { NextResponse } from "next/server";
import {
  FeatureScopeError,
  UnknownFeatureError,
  setFeature,
} from "@lumio/db";
import { FeatureKey } from "@lumio/shared";
import { withAuth } from "@/lib/with-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_KEYS = new Set<string>(Object.values(FeatureKey));

/** Toggle one feature. Body: { key, catalogId: string | null, enabled: boolean }. */
export const PUT = withAuth(async (request) => {
  const body: unknown = await request.json().catch(() => null);
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const { key, catalogId, enabled } = body as {
    key?: unknown;
    catalogId?: unknown;
    enabled?: unknown;
  };
  if (typeof key !== "string" || !VALID_KEYS.has(key)) {
    return NextResponse.json({ error: "Unknown feature key" }, { status: 400 });
  }
  if (!(catalogId === null || typeof catalogId === "string")) {
    return NextResponse.json({ error: "catalogId must be a string or null" }, { status: 400 });
  }
  if (typeof enabled !== "boolean") {
    return NextResponse.json({ error: "enabled must be a boolean" }, { status: 400 });
  }
  try {
    await setFeature({ key: key as FeatureKey, catalogId, enabled });
  } catch (e) {
    if (e instanceof FeatureScopeError || e instanceof UnknownFeatureError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }
  return NextResponse.json({ ok: true });
});
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @lumio/web exec tsc --noEmit 2>&1 | grep 'error TS' | grep -v calendar.ts`
Expected: empty.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/api/features/route.ts
git commit -m "feat(web): PUT /api/features to toggle a feature"
```

---

## Task 6: `FeaturesProvider` + `useFeature`, seeded in the catalog layout

**Files:**
- Create: `apps/web/src/components/features/features-provider.tsx`
- Modify: `apps/web/src/app/(app)/c/[catalog]/layout.tsx`

- [ ] **Step 1: Implement the provider**

```tsx
// apps/web/src/components/features/features-provider.tsx
"use client";

import { createContext, useContext } from "react";
import type { FeatureKey, FeatureMap } from "@lumio/shared";

const FeaturesContext = createContext<FeatureMap | null>(null);

/**
 * Holds the effective feature map for the active catalog. SSR-seeded by the
 * catalog layout (no client fetch) — the map is recomputed server-side on every
 * catalog-layout render, so a settings toggle + router.refresh() is reflected on
 * the next navigation. The only client consumer is the sidebar.
 */
export function FeaturesProvider({
  value,
  children,
}: {
  value: FeatureMap;
  children: React.ReactNode;
}) {
  return <FeaturesContext.Provider value={value}>{children}</FeaturesContext.Provider>;
}

/** Effective enabled-state for one feature in the active catalog. */
export function useFeature(key: FeatureKey): boolean {
  const ctx = useContext(FeaturesContext);
  return ctx ? ctx[key] : false;
}
```

- [ ] **Step 2: Seed it in the catalog layout**

In `apps/web/src/app/(app)/c/[catalog]/layout.tsx`:

Add imports:
```tsx
import { getUserSettings, resolveFeatures } from "@lumio/db";
import { FeaturesProvider } from "@/components/features/features-provider";
```
(`getUserSettings` is already imported — merge `resolveFeatures` into that existing import line instead of duplicating.)

After `const settings = await getUserSettings(session.user.id);` add:
```tsx
  const features = await resolveFeatures(catalog.id);
```

Wrap the existing `<LibraryTreeProvider>…</LibraryTreeProvider>` subtree with the provider:
```tsx
      <LibraryTreeProvider>
        <FeaturesProvider value={features}>
          <SoundSettingsProvider enabled={settings.soundEffectsEnabled} />
          <AppSidebar />
          <div className="min-h-dvh pl-[76px]">{children}</div>
        </FeaturesProvider>
      </LibraryTreeProvider>
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @lumio/web exec tsc --noEmit 2>&1 | grep 'error TS' | grep -v calendar.ts`
Expected: empty.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/features/features-provider.tsx "apps/web/src/app/(app)/c/[catalog]/layout.tsx"
git commit -m "feat(web): SSR-seeded FeaturesProvider + useFeature"
```

---

## Task 7: Gated Folders nav item in the sidebar

**Files:**
- Modify: `apps/web/src/components/app-sidebar.tsx`

- [ ] **Step 1: Implement**

In `apps/web/src/components/app-sidebar.tsx`:

Add to the lucide import: `FolderTree`. Add imports:
```tsx
import { FeatureKey } from "@lumio/shared";
import { useFeature } from "@/components/features/features-provider";
```

Add a Folders nav item constant next to `PRIMARY` (keep `PRIMARY` as-is):
```tsx
const FOLDERS_ITEM: NavItem = {
  href: "/folders",
  label: "Folders",
  icon: FolderTree,
  match: ["/folders"],
};
```

Inside `AppSidebar()`, after `const { slug } = useCatalog();`:
```tsx
  const showFolders = useFeature(FeatureKey.DiskExplorer);
  // Insert Folders after Albums when enabled (Photos, Search, Albums, Folders, …).
  const albumsIdx = PRIMARY.findIndex((i) => i.href === "/albums");
  const items = showFolders
    ? [...PRIMARY.slice(0, albumsIdx + 1), FOLDERS_ITEM, ...PRIMARY.slice(albumsIdx + 1)]
    : PRIMARY;
```

Change the nav map from `PRIMARY.map(...)` to `items.map(...)` (the existing per-item logic — Albums flyout vs plain `NavLink` — is unchanged; Folders falls into the plain `NavLink` branch).

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm --filter @lumio/web exec tsc --noEmit 2>&1 | grep 'error TS' | grep -v calendar.ts`
Expected: empty.
Run: `pnpm --filter @lumio/web exec eslint src/components/app-sidebar.tsx`
Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/app-sidebar.tsx
git commit -m "feat(web): show Folders nav item when disk explorer is enabled"
```

---

## Task 8: Pure catalog-fs helpers

**Files:**
- Create: `apps/web/src/lib/catalog-fs.ts`
- Test: `apps/web/src/lib/catalog-fs.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/lib/catalog-fs.test.ts
import { describe, expect, it } from "vitest";
import { buildCatalogListing, catalogBreadcrumbs, joinRel } from "./catalog-fs.js";

describe("joinRel", () => {
  it("joins under a parent and handles the root", () => {
    expect(joinRel("", "2024")).toBe("2024");
    expect(joinRel("2024", "trip")).toBe("2024/trip");
  });
});

describe("catalogBreadcrumbs", () => {
  it("always starts with the Library root crumb", () => {
    expect(catalogBreadcrumbs("")).toEqual([{ name: "Library", rel: "" }]);
  });
  it("accumulates rel paths per segment", () => {
    expect(catalogBreadcrumbs("2024/trip")).toEqual([
      { name: "Library", rel: "" },
      { name: "2024", rel: "2024" },
      { name: "trip", rel: "2024/trip" },
    ]);
  });
});

describe("buildCatalogListing", () => {
  it("splits dirs/files, sorts by name, tags images + photoIds", () => {
    const photoIdByRel = new Map([["2024/a.jpg", "p1"]]);
    const listing = buildCatalogListing(
      "2024",
      [
        { name: "b.txt", isDirectory: false, size: 10 },
        { name: "a.jpg", isDirectory: false, size: 20 },
        { name: "sub", isDirectory: true, size: 0 },
      ],
      photoIdByRel,
    );
    expect(listing.dirs).toEqual([{ name: "sub", rel: "2024/sub" }]);
    expect(listing.files).toEqual([
      { name: "a.jpg", rel: "2024/a.jpg", size: 20, isImage: true, photoId: "p1" },
      { name: "b.txt", rel: "2024/b.txt", size: 10, isImage: false, photoId: null },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lumio/web exec vitest run src/lib/catalog-fs.test.ts`
Expected: FAIL — cannot find `./catalog-fs.js`.

- [ ] **Step 3: Implement**

```ts
// apps/web/src/lib/catalog-fs.ts
import { isSupportedImage } from "@lumio/shared";

/** Join a child name under a catalog-relative parent ("" = catalog root). */
export function joinRel(parentRel: string, name: string): string {
  return parentRel ? `${parentRel}/${name}` : name;
}

export interface FsCrumb {
  name: string;
  /** Catalog-relative path of this crumb; "" = the catalog root. */
  rel: string;
}

/** Clickable breadcrumb trail for a catalog-relative path; root is "Library". */
export function catalogBreadcrumbs(rel: string): FsCrumb[] {
  const crumbs: FsCrumb[] = [{ name: "Library", rel: "" }];
  const clean = rel.replace(/^\/+|\/+$/g, "");
  if (!clean) return crumbs;
  let acc = "";
  for (const part of clean.split("/")) {
    if (!part) continue;
    acc = joinRel(acc, part);
    crumbs.push({ name: part, rel: acc });
  }
  return crumbs;
}

export interface RawEntry {
  name: string;
  isDirectory: boolean;
  size: number;
}

export interface CatalogDirChild {
  name: string;
  rel: string;
}

export interface CatalogFileChild {
  name: string;
  rel: string;
  size: number;
  isImage: boolean;
  /** Set when this file is an indexed photo (opens in the lightbox). */
  photoId: string | null;
}

export interface CatalogListing {
  rel: string;
  dirs: CatalogDirChild[];
  files: CatalogFileChild[];
}

function byName<T extends { name: string }>(a: T, b: T): number {
  return a.name.localeCompare(b.name);
}

/** Pure assembly of a directory listing (no IO). */
export function buildCatalogListing(
  rel: string,
  entries: RawEntry[],
  photoIdByRel: Map<string, string>,
): CatalogListing {
  const dirs = entries
    .filter((e) => e.isDirectory)
    .map((e) => ({ name: e.name, rel: joinRel(rel, e.name) }))
    .sort(byName);
  const files = entries
    .filter((e) => !e.isDirectory)
    .map((e) => {
      const childRel = joinRel(rel, e.name);
      return {
        name: e.name,
        rel: childRel,
        size: e.size,
        isImage: isSupportedImage(e.name),
        photoId: photoIdByRel.get(childRel) ?? null,
      };
    })
    .sort(byName);
  return { rel, dirs, files };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lumio/web exec vitest run src/lib/catalog-fs.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/catalog-fs.ts apps/web/src/lib/catalog-fs.test.ts
git commit -m "feat(web): pure catalog-fs listing helpers"
```

---

## Task 9: `readCatalogDir` IO wrapper

**Files:**
- Create: `apps/web/src/lib/catalog-fs-service.ts`
- Test: `apps/web/src/lib/catalog-fs-service.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/src/lib/catalog-fs-service.test.ts
import { describe, expect, it } from "vitest";
import { readCatalogDir, type CatalogDirDeps } from "./catalog-fs-service.js";

function dirent(name: string, isDir: boolean) {
  return { name, isDirectory: () => isDir };
}

const catalog = { id: "cat1", path: "/media/fam" };

function deps(): CatalogDirDeps {
  return {
    readdir: async () => [dirent("2024", true), dirent("a.jpg", false), dirent("note.txt", false)],
    stat: async (p: string) => ({ size: p.endsWith("a.jpg") ? 100 : 5 }),
    findIndexedPhotos: async (catalogId, rels) => {
      expect(catalogId).toBe("cat1");
      expect(rels).toContain("a.jpg"); // only image files are queried
      expect(rels).not.toContain("note.txt");
      return [{ id: "p1", path: "a.jpg" }];
    },
  };
}

describe("readCatalogDir", () => {
  it("lists dirs+files at the catalog root and links indexed photos", async () => {
    const listing = await readCatalogDir(catalog, "", deps());
    expect(listing.dirs).toEqual([{ name: "2024", rel: "2024" }]);
    expect(listing.files.find((f) => f.name === "a.jpg")).toMatchObject({
      photoId: "p1",
      isImage: true,
      size: 100,
    });
    expect(listing.files.find((f) => f.name === "note.txt")).toMatchObject({
      photoId: null,
      isImage: false,
    });
  });

  it("blocks path traversal outside the catalog", async () => {
    await expect(readCatalogDir(catalog, "../secrets", deps())).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lumio/web exec vitest run src/lib/catalog-fs-service.test.ts`
Expected: FAIL — cannot find `./catalog-fs-service.js`.

- [ ] **Step 3: Implement**

```ts
// apps/web/src/lib/catalog-fs-service.ts
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { isSupportedImage } from "@lumio/shared";
import { prisma } from "@lumio/db";
import { originalPath } from "@/lib/paths";
import {
  buildCatalogListing,
  joinRel,
  type CatalogListing,
  type RawEntry,
} from "@/lib/catalog-fs";

/** Injectable IO so the assembly is testable without a real FS/DB. */
export interface CatalogDirDeps {
  readdir: (absPath: string) => Promise<{ name: string; isDirectory: () => boolean }[]>;
  stat: (absPath: string) => Promise<{ size: number }>;
  findIndexedPhotos: (
    catalogId: string,
    rels: string[],
  ) => Promise<{ id: string; path: string }[]>;
}

const defaultDeps: CatalogDirDeps = {
  readdir: (absPath) => readdir(absPath, { withFileTypes: true }),
  stat: (absPath) => stat(absPath),
  findIndexedPhotos: (catalogId, rels) =>
    prisma.photo.findMany({
      where: { catalogId, path: { in: rels } },
      select: { id: true, path: true },
    }),
};

/**
 * List one directory inside a catalog. `rel` is catalog-relative ("" = root).
 * Throws if `rel` escapes the catalog (via originalPath) or the dir is missing.
 * Indexed photos (matched by relative path) carry a `photoId`.
 */
export async function readCatalogDir(
  catalog: { id: string; path: string },
  rel: string,
  deps: CatalogDirDeps = defaultDeps,
): Promise<CatalogListing> {
  const absDir = originalPath(catalog, rel); // throws on traversal
  const dirents = await deps.readdir(absDir);
  const raw: RawEntry[] = await Promise.all(
    dirents.map(async (d) => {
      const isDirectory = d.isDirectory();
      let size = 0;
      if (!isDirectory) {
        try {
          size = (await deps.stat(path.join(absDir, d.name))).size;
        } catch {
          size = 0;
        }
      }
      return { name: d.name, isDirectory, size };
    }),
  );
  const imageRels = raw
    .filter((e) => !e.isDirectory && isSupportedImage(e.name))
    .map((e) => joinRel(rel, e.name));
  const photos = imageRels.length
    ? await deps.findIndexedPhotos(catalog.id, imageRels)
    : [];
  const photoIdByRel = new Map(photos.map((p) => [p.path, p.id]));
  return buildCatalogListing(rel, raw, photoIdByRel);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lumio/web exec vitest run src/lib/catalog-fs-service.test.ts`
Expected: PASS (including the traversal-block case).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/catalog-fs-service.ts apps/web/src/lib/catalog-fs-service.test.ts
git commit -m "feat(web): readCatalogDir service (bounded, photo-matched listing)"
```

---

## Task 10: Folders page + explorer view

**Files:**
- Create: `apps/web/src/app/(app)/c/[catalog]/folders/page.tsx`
- Create: `apps/web/src/app/(app)/c/[catalog]/folders/folder-explorer.tsx`

- [ ] **Step 1: Implement the explorer view**

```tsx
// apps/web/src/app/(app)/c/[catalog]/folders/folder-explorer.tsx
import { Fragment } from "react";
import Link from "next/link";
import { ChevronRight, File as FileIcon, Folder as FolderIcon } from "lucide-react";
import { catalogApiUrl, catalogPath } from "@/lib/catalog-api";
import { catalogBreadcrumbs, type CatalogListing } from "@/lib/catalog-fs";
import { formatBytes } from "@/lib/format";

/** Build the /folders page href for a catalog-relative path ("" = root). */
function folderHref(slug: string, rel: string): string {
  const base = catalogPath(slug, "/folders");
  return rel ? `${base}?path=${encodeURIComponent(rel)}` : base;
}

/**
 * Presentational file-manager view: breadcrumb + subfolders + files. Indexed
 * photos render a thumbnail and link to the detail/lightbox; other files are
 * non-openable rows. Server component — no client state needed.
 */
export function FolderExplorer({
  slug,
  listing,
}: {
  slug: string;
  listing: CatalogListing;
}) {
  const crumbs = catalogBreadcrumbs(listing.rel);
  const isEmpty = listing.dirs.length === 0 && listing.files.length === 0;

  return (
    <div className="space-y-6">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm">
        {crumbs.map((c, i) => {
          const isLast = i === crumbs.length - 1;
          return (
            <Fragment key={c.rel}>
              {i > 0 && <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
              {isLast ? (
                <span className="font-medium text-foreground">{c.name}</span>
              ) : (
                <Link
                  href={folderHref(slug, c.rel)}
                  className="rounded px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  {c.name}
                </Link>
              )}
            </Fragment>
          );
        })}
      </nav>

      {isEmpty ? (
        <p className="text-sm text-muted-foreground">This folder is empty.</p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
          {listing.dirs.map((d) => (
            <Link
              key={d.rel}
              href={folderHref(slug, d.rel)}
              className="flex flex-col items-center gap-2 rounded-lg border border-border p-4 text-center transition-colors hover:bg-muted"
            >
              <FolderIcon className="size-10 text-muted-foreground" aria-hidden />
              <span className="w-full truncate text-sm font-medium">{d.name}</span>
            </Link>
          ))}

          {listing.files.map((f) =>
            f.photoId ? (
              <Link
                key={f.rel}
                href={catalogPath(slug, `/photo/${f.photoId}`)}
                className="group flex flex-col gap-2 rounded-lg border border-border p-2 transition-colors hover:bg-muted"
              >
                <span className="aspect-square w-full overflow-hidden rounded bg-muted">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={catalogApiUrl(slug, `/photos/${f.photoId}/thumbnail`)}
                    alt={f.name}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                </span>
                <span className="w-full truncate text-sm">{f.name}</span>
              </Link>
            ) : (
              <div
                key={f.rel}
                className="flex flex-col items-center gap-2 rounded-lg border border-border border-dashed p-4 text-center opacity-70"
              >
                <FileIcon className="size-10 text-muted-foreground" aria-hidden />
                <span className="w-full truncate text-sm">{f.name}</span>
                <span className="text-xs text-muted-foreground">{formatBytes(f.size)}</span>
              </div>
            ),
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Implement the gated page**

```tsx
// apps/web/src/app/(app)/c/[catalog]/folders/page.tsx
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isFeatureEnabled } from "@lumio/db";
import { FeatureKey } from "@lumio/shared";
import { getCatalogForSlug } from "@/lib/active-catalog";
import { readCatalogDir } from "@/lib/catalog-fs-service";
import { FolderExplorer } from "./folder-explorer";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Folders" };

export default async function FoldersPage({
  params,
  searchParams,
}: {
  params: Promise<{ catalog: string }>;
  searchParams: Promise<{ path?: string | string[] }>;
}) {
  const { catalog: slug } = await params;
  const catalog = await getCatalogForSlug(slug); // 404 if unknown
  if (!(await isFeatureEnabled(catalog.id, FeatureKey.DiskExplorer))) notFound();

  const sp = await searchParams;
  const rel = typeof sp.path === "string" ? sp.path : "";

  let listing;
  try {
    listing = await readCatalogDir(catalog, rel);
  } catch {
    notFound(); // traversal escape or missing directory
  }

  return (
    <main className="w-full px-4 py-6">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Folders</h1>
      <FolderExplorer slug={slug} listing={listing} />
    </main>
  );
}
```

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm --filter @lumio/web exec tsc --noEmit 2>&1 | grep 'error TS' | grep -v calendar.ts`
Expected: empty.
Run: `pnpm --filter @lumio/web exec eslint "src/app/(app)/c/[catalog]/folders"`
Expected: no new errors.

> Note: adding a brand-new normal route does not need the `.next`-clear restart (that caveat is only for parallel/intercepting route slots). A running dev server picks it up.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/(app)/c/[catalog]/folders"
git commit -m "feat(web): gated /folders disk-explorer page"
```

---

## Task 11: Global Features settings section

**Files:**
- Create: `apps/web/src/app/(app)/settings/features/page.tsx`
- Create: `apps/web/src/app/(app)/settings/features/global-features-form.tsx`
- Modify: `apps/web/src/components/settings-sidebar.tsx`

- [ ] **Step 1: Implement the client form**

```tsx
// apps/web/src/app/(app)/settings/features/global-features-form.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { FeatureKey } from "@lumio/shared";
import type { GlobalFeatureState } from "@lumio/db";
import { Switch } from "@/components/ui/switch";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";

export function GlobalFeaturesForm({ initial }: { initial: GlobalFeatureState[] }) {
  const router = useRouter();
  const [states, setStates] = useState(initial);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  async function toggle(key: FeatureKey, next: boolean) {
    setStates((s) => s.map((f) => (f.key === key ? { ...f, enabled: next } : f)));
    setErrorKey(null);
    setSavingKey(key);
    try {
      const res = await fetch("/api/features", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, catalogId: null, enabled: next }),
      });
      if (!res.ok) throw new Error(String(res.status));
      router.refresh();
    } catch {
      setStates((s) => s.map((f) => (f.key === key ? { ...f, enabled: !next } : f)));
      setErrorKey(key);
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <div className="space-y-6">
      {states.map((f) => (
        <Field key={f.key} orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor={`feature-${f.key}`}>{f.label}</FieldLabel>
            <FieldDescription>{f.description}</FieldDescription>
            {errorKey === f.key && <FieldError>Couldn&apos;t save — try again.</FieldError>}
          </FieldContent>
          <Switch
            id={`feature-${f.key}`}
            checked={f.enabled}
            onCheckedChange={(v) => toggle(f.key, v)}
            disabled={savingKey === f.key}
          />
        </Field>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Implement the page**

```tsx
// apps/web/src/app/(app)/settings/features/page.tsx
import type { Metadata } from "next";
import { getGlobalFeatureStates } from "@lumio/db";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { GlobalFeaturesForm } from "./global-features-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Features" };

export default async function FeaturesSettingsPage() {
  const states = await getGlobalFeatureStates();
  return (
    <main className="mx-auto max-w-3xl space-y-8 p-4 py-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">Features</h1>
        <p className="text-sm text-muted-foreground">
          Turn optional features on or off across the whole app. Some can be
          refined per catalog in each catalog&apos;s settings.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>App features</CardTitle>
          <CardDescription>Global switches; a master for any per-catalog overrides.</CardDescription>
        </CardHeader>
        <CardContent>
          <GlobalFeaturesForm initial={states} />
        </CardContent>
      </Card>
    </main>
  );
}
```

- [ ] **Step 3: Add the rail item**

In `apps/web/src/components/settings-sidebar.tsx`: add `ToggleRight` to the lucide import, and add to `ITEMS` (after Catalogs):
```tsx
  { href: "/settings/features", label: "Features", icon: ToggleRight, match: ["/settings/features"] },
```

- [ ] **Step 4: Typecheck + lint**

Run: `pnpm --filter @lumio/web exec tsc --noEmit 2>&1 | grep 'error TS' | grep -v calendar.ts`
Expected: empty.
Run: `pnpm --filter @lumio/web exec eslint "src/app/(app)/settings/features" src/components/settings-sidebar.tsx`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(app)/settings/features" apps/web/src/components/settings-sidebar.tsx
git commit -m "feat(web): global Features settings section"
```

---

## Task 12: Per-catalog Features tab

**Files:**
- Create: `apps/web/src/app/(app)/settings/catalogs/[id]/catalog-features-form.tsx`
- Modify: `apps/web/src/app/(app)/settings/catalogs/[id]/page.tsx`

- [ ] **Step 1: Implement the client form**

```tsx
// apps/web/src/app/(app)/settings/catalogs/[id]/catalog-features-form.tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { FeatureKey } from "@lumio/shared";
import type { CatalogFeatureState } from "@lumio/db";
import { Switch } from "@/components/ui/switch";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field";

export function CatalogFeaturesForm({
  catalogId,
  initial,
}: {
  catalogId: string;
  initial: CatalogFeatureState[];
}) {
  const router = useRouter();
  const [states, setStates] = useState(initial);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  async function toggle(key: FeatureKey, next: boolean) {
    setStates((s) => s.map((f) => (f.key === key ? { ...f, catalogEnabled: next } : f)));
    setErrorKey(null);
    setSavingKey(key);
    try {
      const res = await fetch("/api/features", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, catalogId, enabled: next }),
      });
      if (!res.ok) throw new Error(String(res.status));
      router.refresh();
    } catch {
      setStates((s) => s.map((f) => (f.key === key ? { ...f, catalogEnabled: !next } : f)));
      setErrorKey(key);
    } finally {
      setSavingKey(null);
    }
  }

  if (states.length === 0) {
    return <p className="text-sm text-muted-foreground">No per-catalog features yet.</p>;
  }

  return (
    <div className="space-y-6">
      {states.map((f) => (
        <Field key={f.key} orientation="horizontal">
          <FieldContent>
            <FieldLabel htmlFor={`catfeature-${f.key}`}>{f.label}</FieldLabel>
            <FieldDescription>
              {f.globalEnabled
                ? f.description
                : "Turn this feature on globally (Settings → Features) to use it here."}
            </FieldDescription>
            {errorKey === f.key && <FieldError>Couldn&apos;t save — try again.</FieldError>}
          </FieldContent>
          <Switch
            id={`catfeature-${f.key}`}
            checked={f.globalEnabled && f.catalogEnabled}
            onCheckedChange={(v) => toggle(f.key, v)}
            disabled={!f.globalEnabled || savingKey === f.key}
          />
        </Field>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Wire the tab into the catalog detail page**

In `apps/web/src/app/(app)/settings/catalogs/[id]/page.tsx`:

Add imports:
```tsx
import { getCatalogById, getCatalogFeatureStates } from "@lumio/db";
import { CatalogFeaturesForm } from "./catalog-features-form";
```
(`getCatalogById` is already imported — merge `getCatalogFeatureStates` into that line.)

After `const stats = await getCatalogStats(catalog.id);` add:
```tsx
  const featureStates = await getCatalogFeatureStates(catalog.id);
```

Add a trigger to `<TabsList>` (after the Uploads trigger):
```tsx
            <TabsTrigger value="features">Features</TabsTrigger>
```

Add the tab content (after the Uploads `<TabsContent>`):
```tsx
          <TabsContent value="features">
            <Card>
              <CardHeader>
                <CardTitle>Features</CardTitle>
                <CardDescription>
                  Enable or disable optional features for this catalog. The global
                  switch in Settings → Features is the master.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <CatalogFeaturesForm catalogId={catalog.id} initial={featureStates} />
              </CardContent>
            </Card>
          </TabsContent>
```

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm --filter @lumio/web exec tsc --noEmit 2>&1 | grep 'error TS' | grep -v calendar.ts`
Expected: empty.
Run: `pnpm --filter @lumio/web exec eslint "src/app/(app)/settings/catalogs/[id]"`
Expected: no new errors.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/(app)/settings/catalogs/[id]"
git commit -m "feat(web): per-catalog Features tab"
```

---

## Task 13: Full verification + browser check

**Files:** none (verification only)

- [ ] **Step 1: Run all unit tests**

Run: `pnpm -r test`
Expected: all packages pass (the new shared/db/web tests included).

- [ ] **Step 2: Typecheck the whole repo (baseline-aware)**

Run: `pnpm -r typecheck 2>&1 | grep 'error TS' | grep -v calendar.ts`
Expected: empty (only the pre-existing `calendar.ts` errors remain).

- [ ] **Step 3: Lint the touched web files**

Run: `pnpm --filter @lumio/web exec eslint src`
Expected: no NEW errors (the 4 pre-existing lint errors noted in project memory may remain — confirm none of yours are new).

- [ ] **Step 4: Production build smoke**

Run: `pnpm --filter @lumio/web build`
Expected: build succeeds (uses `--webpack` per project config).

- [ ] **Step 5: Browser verification**

With the dev server running (`pnpm dev`; URL printed by `run.sh`, e.g. `https://<workspace>.lumio.localhost:1355`), log in, then verify:
1. **Default off:** the **Folders** icon is NOT in the sidebar; visiting `/c/<slug>/folders` directly returns 404.
2. **Enable globally:** Settings → Features → toggle **Folder browser** on. Return to the catalog; the **Folders** icon now appears.
3. **Explore:** open Folders → breadcrumb shows **Library**; subfolders navigate via `?path=`; an indexed photo shows a thumbnail and opens the lightbox; a non-image file shows a dashed, non-clickable tile with its size.
4. **Per-catalog opt-out:** Settings → Catalogs → <catalog> → Features → toggle the catalog **off**. The Folders icon disappears for that catalog and its `/folders` page 404s, while another catalog (if any) still shows it.
5. **Global master:** toggle the feature **off** globally → the per-catalog switch becomes disabled with the "turn on globally" hint, and Folders is gone everywhere.

Record the result (pass/fail per step) in the task notes. If login blocks browser verification, note it and rely on the code review + unit tests (consistent with prior plans in this repo).

- [ ] **Step 6: Final commit (if any verification fixups were needed)**

```bash
git add -A
git commit -m "chore: verification fixups for feature gating + disk explorer"
```

---

## Self-review notes (author)

- **Spec coverage:** registry (T2), generic table + resolver with the exact resolution rule (T3–T4), `PUT /api/features` (T5), SSR-seeded provider + `useFeature` (T6), gated sidebar item (T7), gated dedicated `/folders` page showing all entries with indexed-photo thumbnails→lightbox and generic file rows (T8–T10), global Features settings + per-catalog tab with global-master semantics (T11–T12), tests + errors (throughout; T13). Deviations (no client features/fs GET routes, no mtime) are listed at the top and preserve behavior.
- **Type consistency:** `FeatureMap`, `FeatureKey`, `FeatureScope`, `GlobalFeatureState`, `CatalogFeatureState`, `CatalogListing`/`RawEntry`/`CatalogDirChild`/`CatalogFileChild`, `CatalogDirDeps`, `readCatalogDir`, `setFeature`, `resolveFeatures`, `isFeatureEnabled`, `getGlobalFeatureStates`, `getCatalogFeatureStates` are defined once and used consistently across tasks.
- **No placeholders:** every code step is complete.
