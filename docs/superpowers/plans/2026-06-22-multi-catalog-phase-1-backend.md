# Multi-Catalog — Phase 1: Backend Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the data model, ingestion worker, and shared/db/jobs packages catalog-aware — every Photo/Album/Folder/TrashedPhoto belongs to a `Catalog`, the worker watches and indexes *all* catalogs continuously, and cache/trash live under per-catalog subtrees. No web UI wiring yet (Phases 2–4).

**Architecture:** Add a `Catalog` model as the top-level scope and a per-user `UserSettings` model; backfill is intentionally skipped (clean wipe). The ingest pipeline and worker thread a `catalogId` + per-catalog root/cache dirs through every create/lookup/remove. The worker resolves which catalog a filesystem event belongs to by longest-prefix match against the catalog roots, and reconciles its watch set against the `Catalog` table so in-app create/delete (Phase 2+) take effect without a restart.

**Tech Stack:** TypeScript (ESM, `.js` import specifiers), Prisma + Postgres (shared dev DB on host port **5433**), chokidar, Vitest, pnpm monorepo.

**Scope boundary / expected red state:** This phase changes the schema and the worker/ingest/db/jobs/shared packages. It deliberately leaves `apps/web` partially **not type-checking** (album/folder creation and the worker `deps` now require a `catalogId` the web layer doesn't supply until Phases 2–3; `AppSettings` is *kept* this phase and retired during the settings-reorg phase). Verification for this plan targets the backend packages: `@lumio/shared`, `@lumio/db`, `@lumio/ingest`, `@lumio/jobs`, and `apps/worker`. Do **not** try to make `apps/web` green here.

**⚠️ Shared-DB warning (read before Task 1):** The dev Postgres is shared across *all* Conductor workspaces. The Task 1 migration is **destructive** — it truncates Photo/Album/Folder/TrashedPhoto/Job for every workspace. Confirm with the user immediately before applying it, and apply it with `prisma migrate deploy` (never `migrate dev`/`reset`) per the project's non-destructive migration recipe.

---

## File Structure

**Created:**
- `packages/shared/src/catalogs.ts` — pure catalog helpers (`slugify`) + DTO/Zod types, framework-agnostic.
- `packages/shared/src/catalogs.test.ts` — slugify tests.
- `packages/db/src/catalogs.ts` — catalog CRUD + slug-uniqueness resolver (injectable `db`).
- `packages/db/src/catalogs.test.ts` — CRUD/slug tests with a fake db.
- `packages/db/src/user-settings.ts` — per-user settings get/update.
- `packages/db/src/user-settings.test.ts` — tests with a fake db.
- `packages/db/prisma/migrations/20260622120000_multi_catalog/migration.sql` — hand-written destructive migration.
- `apps/worker/src/catalog-routing.ts` — pure `catalogForPath` longest-prefix matcher.
- `apps/worker/src/catalog-routing.test.ts` — routing tests.

**Modified:**
- `packages/db/prisma/schema.prisma` — `Catalog` + `UserSettings` models; `catalogId` on Photo/Album/Folder/TrashedPhoto; nullable `catalogId` on Job; composite Photo uniqueness.
- `packages/db/src/index.ts` — export the two new modules.
- `packages/shared/src/index.ts` — export `./catalogs.js` (verify the barrel pattern first).
- `packages/ingest/src/store.ts` — `catalogId` in `StoreInput` + composite upsert.
- `packages/ingest/src/ingest.ts` — `catalogId` in `IngestDeps`/`RemoveDeps`; composite lookups.
- `packages/ingest/src/find-by-hash.ts` — `catalogId` filter.
- `packages/jobs/src/purge.ts` — `catalogId` scoping for `purgeAllPhotos`/`purgeTrash`.
- `apps/worker/src/config.ts` — drop `PHOTOS_DIR`; per-catalog cache path helpers.
- `apps/worker/src/deps.ts` — per-catalog dep factories.
- `apps/worker/src/scan.ts` — per-catalog scan loop.
- `apps/worker/src/watch.ts` — multi-root watch + reconcile loop.
- `apps/worker/src/handlers.ts` — catalog-scoped job handlers.
- `apps/worker/src/bench.ts`, `apps/worker/src/seed.ts` — drop `PHOTOS_DIR` (dev tools take an explicit dir arg).

---

## Task 1: Schema + destructive migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260622120000_multi_catalog/migration.sql`

- [ ] **Step 1: Add the `Catalog` and `UserSettings` models to `schema.prisma`**

Add these two models (anywhere after `datasource`):

```prisma
model Catalog {
  id             String         @id @default(cuid())
  name           String
  slug           String         @unique
  path           String         @unique
  uploadTemplate String         @default("{YYYY}/{YYYY}-{MM}-{DD}/{filename}")
  createdAt      DateTime       @default(now())
  updatedAt      DateTime       @updatedAt
  photos         Photo[]
  albums         Album[]
  folders        Folder[]
  trashedPhotos  TrashedPhoto[]
}

model UserSettings {
  userId              String   @id
  user                User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  soundEffectsEnabled Boolean  @default(true)
  updatedAt           DateTime @updatedAt
}
```

- [ ] **Step 2: Add `catalogId` to the scoped models in `schema.prisma`**

In `Photo`: remove `@unique` from the `path` field, add the relation + composite unique + index:
```prisma
  path           String       // was: @unique — now unique per catalog
  catalogId      String
  catalog        Catalog      @relation(fields: [catalogId], references: [id], onDelete: Cascade)
  // ...existing fields/indexes unchanged...
  @@unique([catalogId, path])
  @@index([catalogId])
```

In `Album`, `Folder`, `TrashedPhoto`: add (and add a back-relation field to `User` for `UserSettings`):
```prisma
  // Album:
  catalogId String
  catalog   Catalog @relation(fields: [catalogId], references: [id], onDelete: Cascade)
  @@index([catalogId])
  // Folder: same two lines + @@index([catalogId])
  // TrashedPhoto: same two lines + @@index([catalogId])
```

In `Job`: `catalogId String?` (nullable). In `User`: add `settings UserSettings?`.

- [ ] **Step 3: Hand-write the migration SQL**

Create `packages/db/prisma/migrations/20260622120000_multi_catalog/migration.sql`:

```sql
-- Multi-catalog: Catalog becomes the top-level scope. Destructive clean wipe
-- (no backfill) — photo/album/folder/trash/job data is truncated; re-scan rebuilds.

-- 1. Wipe scoped data first so the new NOT NULL catalogId columns add cleanly.
TRUNCATE TABLE "AlbumPhoto", "Album", "Folder", "TrashedPhoto", "Photo", "Job" RESTART IDENTITY CASCADE;

-- 2. Catalog.
CREATE TABLE "Catalog" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "uploadTemplate" TEXT NOT NULL DEFAULT '{YYYY}/{YYYY}-{MM}-{DD}/{filename}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Catalog_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Catalog_slug_key" ON "Catalog"("slug");
CREATE UNIQUE INDEX "Catalog_path_key" ON "Catalog"("path");

-- 3. UserSettings.
CREATE TABLE "UserSettings" (
  "userId" TEXT NOT NULL,
  "soundEffectsEnabled" BOOLEAN NOT NULL DEFAULT true,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserSettings_pkey" PRIMARY KEY ("userId")
);
ALTER TABLE "UserSettings" ADD CONSTRAINT "UserSettings_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 4. catalogId columns (NOT NULL is safe — tables were just truncated).
ALTER TABLE "Photo" ADD COLUMN "catalogId" TEXT NOT NULL;
ALTER TABLE "Album" ADD COLUMN "catalogId" TEXT NOT NULL;
ALTER TABLE "Folder" ADD COLUMN "catalogId" TEXT NOT NULL;
ALTER TABLE "TrashedPhoto" ADD COLUMN "catalogId" TEXT NOT NULL;
ALTER TABLE "Job" ADD COLUMN "catalogId" TEXT;

-- 5. Photo path uniqueness: global -> per-catalog.
DROP INDEX "Photo_path_key";
CREATE UNIQUE INDEX "Photo_catalogId_path_key" ON "Photo"("catalogId", "path");
CREATE INDEX "Photo_catalogId_idx" ON "Photo"("catalogId");
CREATE INDEX "Album_catalogId_idx" ON "Album"("catalogId");
CREATE INDEX "Folder_catalogId_idx" ON "Folder"("catalogId");
CREATE INDEX "TrashedPhoto_catalogId_idx" ON "TrashedPhoto"("catalogId");

-- 6. Foreign keys.
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "Catalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Album" ADD CONSTRAINT "Album_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "Catalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "Catalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrashedPhoto" ADD CONSTRAINT "TrashedPhoto_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "Catalog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

> If `prisma migrate status` reports the real index name for `Photo.path` is not `Photo_path_key`, adjust the `DROP INDEX` line to match (check with `\d "Photo"` in psql).

- [ ] **Step 4: Confirm with the user, then apply (deploy — never reset)**

Pause and get explicit user go-ahead (shared DB). Then:
```bash
pnpm --filter @lumio/db exec dotenv -e ../../.env -- prisma migrate status
pnpm --filter @lumio/db exec dotenv -e ../../.env -- prisma migrate deploy
pnpm --filter @lumio/db exec dotenv -e ../../.env -- prisma generate
```
Expected: `migrate deploy` applies `20260622120000_multi_catalog`; `generate` regenerates the client with `catalog`, `userSettings` models and `catalogId` fields.

- [ ] **Step 5: Verify the client compiles against the new shape**

Run: `pnpm --filter @lumio/db typecheck 2>&1 | grep 'error TS' | grep -v calendar.ts`
Expected: empty (only the pre-existing `calendar.ts` errors are tolerated; none from the schema change).

- [ ] **Step 6: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260622120000_multi_catalog
git commit -m "db: add Catalog + UserSettings models, scope photos/albums/folders/trash by catalogId (destructive)"
```

---

## Task 2: Shared `slugify` + catalog types

**Files:**
- Create: `packages/shared/src/catalogs.ts`, `packages/shared/src/catalogs.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write the failing test**

`packages/shared/src/catalogs.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { slugify } from "./catalogs.js";

describe("slugify", () => {
  it("lowercases and dashes spaces", () => {
    expect(slugify("My Family Photos")).toBe("my-family-photos");
  });
  it("strips punctuation and collapses separators", () => {
    expect(slugify("2024 — Trip!!")).toBe("2024-trip");
  });
  it("trims leading/trailing dashes", () => {
    expect(slugify("  --Hello--  ")).toBe("hello");
  });
  it("falls back to 'catalog' for empty/symbol-only input", () => {
    expect(slugify("   ")).toBe("catalog");
    expect(slugify("***")).toBe("catalog");
  });
});
```

- [ ] **Step 2: Run it; expect failure**

Run: `pnpm --filter @lumio/shared exec vitest run src/catalogs.test.ts`
Expected: FAIL — `Cannot find module './catalogs.js'`.

- [ ] **Step 3: Implement `packages/shared/src/catalogs.ts`**

```ts
import { z } from "zod";

/** Make a URL-safe slug from a catalog name. Always returns a non-empty value. */
export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base || "catalog";
}

export interface CatalogDTO {
  id: string;
  name: string;
  slug: string;
  path: string;
  uploadTemplate: string;
}

export const createCatalogSchema = z.object({
  name: z.string().trim().min(1).max(120),
  path: z.string().trim().min(1),
});
export type CreateCatalogInput = z.infer<typeof createCatalogSchema>;
```

- [ ] **Step 4: Export from the shared barrel**

In `packages/shared/src/index.ts`, add (match the file's existing export style — `export * from "./X.js";`):
```ts
export * from "./catalogs.js";
```

- [ ] **Step 5: Run the test; expect pass**

Run: `pnpm --filter @lumio/shared exec vitest run src/catalogs.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/catalogs.ts packages/shared/src/catalogs.test.ts packages/shared/src/index.ts
git commit -m "shared: add slugify + catalog DTO/schema"
```

---

## Task 3: Catalog CRUD query layer (`packages/db`)

**Files:**
- Create: `packages/db/src/catalogs.ts`, `packages/db/src/catalogs.test.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Write the failing test (fake db, mirrors the `getSettings(db?)` injectable pattern)**

`packages/db/src/catalogs.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { createCatalog, uniqueSlug } from "./catalogs.js";

/** Minimal fake of the `catalog` delegate used by these functions. */
function fakeDb(initial: Array<{ slug: string }> = []) {
  const rows = [...initial];
  return {
    catalog: {
      findUnique: async ({ where: { slug } }: { where: { slug: string } }) =>
        rows.find((r) => r.slug === slug) ?? null,
      create: async ({ data }: { data: { name: string; slug: string; path: string } }) => {
        const row = { id: `cat_${rows.length + 1}`, uploadTemplate: "t", ...data };
        rows.push(row);
        return row;
      },
    },
  };
}

describe("uniqueSlug", () => {
  it("returns the base slug when free", async () => {
    expect(await uniqueSlug("family", fakeDb() as never)).toBe("family");
  });
  it("suffixes -2, -3 on collision", async () => {
    const db = fakeDb([{ slug: "family" }, { slug: "family-2" }]);
    expect(await uniqueSlug("family", db as never)).toBe("family-3");
  });
});

describe("createCatalog", () => {
  it("derives a unique slug from the name", async () => {
    const db = fakeDb([{ slug: "trip" }]);
    const cat = await createCatalog({ name: "Trip", path: "/media/trip" }, db as never);
    expect(cat.slug).toBe("trip-2");
    expect(cat.path).toBe("/media/trip");
  });
});
```

- [ ] **Step 2: Run it; expect failure**

Run: `pnpm --filter @lumio/db exec vitest run src/catalogs.test.ts`
Expected: FAIL — `Cannot find module './catalogs.js'`.

- [ ] **Step 3: Implement `packages/db/src/catalogs.ts`**

```ts
import type { PrismaClient } from "@prisma/client";
import { type CreateCatalogInput, slugify } from "@lumio/shared";
import { prisma } from "./client.js";

type CatalogDb = Pick<PrismaClient, "catalog">;

/** First free slug of the form `base`, `base-2`, `base-3`, … */
export async function uniqueSlug(base: string, db: CatalogDb = prisma): Promise<string> {
  let slug = base;
  let n = 2;
  while (await db.catalog.findUnique({ where: { slug } })) slug = `${base}-${n++}`;
  return slug;
}

export function listCatalogs(db: CatalogDb = prisma) {
  return db.catalog.findMany({ orderBy: { createdAt: "asc" } });
}

export function getCatalogBySlug(slug: string, db: CatalogDb = prisma) {
  return db.catalog.findUnique({ where: { slug } });
}

export function getCatalogById(id: string, db: CatalogDb = prisma) {
  return db.catalog.findUnique({ where: { id } });
}

export async function createCatalog(input: CreateCatalogInput, db: CatalogDb = prisma) {
  const slug = await uniqueSlug(slugify(input.name), db);
  return db.catalog.create({ data: { name: input.name, slug, path: input.path } });
}

export async function renameCatalog(id: string, name: string, db: CatalogDb = prisma) {
  const slug = await uniqueSlug(slugify(name), db);
  return db.catalog.update({ where: { id }, data: { name, slug } });
}

/** Delete the catalog row; FK cascade removes its photos/albums/folders/trash rows.
 *  (Originals/cache cleanup on disk is handled by the worker delete job in Phase 2.) */
export function deleteCatalog(id: string, db: CatalogDb = prisma) {
  return db.catalog.delete({ where: { id } });
}
```

- [ ] **Step 4: Export from the db barrel**

In `packages/db/src/index.ts`, add after the other `export *` lines:
```ts
export * from "./catalogs.js";
```

- [ ] **Step 5: Run the test; expect pass**

Run: `pnpm --filter @lumio/db exec vitest run src/catalogs.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/catalogs.ts packages/db/src/catalogs.test.ts packages/db/src/index.ts
git commit -m "db: catalog CRUD + unique-slug resolver"
```

---

## Task 4: Per-user settings query layer (`packages/db`)

**Files:**
- Create: `packages/db/src/user-settings.ts`, `packages/db/src/user-settings.test.ts`
- Modify: `packages/db/src/index.ts`

> Note: `settings.ts`/`AppSettings` stay in place this phase (web still reads them). They're retired during the settings-reorg phase. `Catalog.uploadTemplate` already exists from Task 1; its read/write wiring is also a later phase.

- [ ] **Step 1: Write the failing test**

`packages/db/src/user-settings.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { getUserSettings, updateUserSettings } from "./user-settings.js";

function fakeDb(initial?: { soundEffectsEnabled: boolean }) {
  let row = initial ? { userId: "u1", updatedAt: new Date(), ...initial } : null;
  return {
    userSettings: {
      upsert: async ({ create, update }: { create: any; update: any }) => {
        row = row ? { ...row, ...update } : { userId: "u1", updatedAt: new Date(), ...create };
        return row;
      },
    },
  };
}

describe("getUserSettings", () => {
  it("creates defaults when absent (soundEffectsEnabled: true)", async () => {
    const s = await getUserSettings("u1", fakeDb() as never);
    expect(s.soundEffectsEnabled).toBe(true);
  });
});

describe("updateUserSettings", () => {
  it("writes only the provided fields", async () => {
    const s = await updateUserSettings("u1", { soundEffectsEnabled: false }, fakeDb({ soundEffectsEnabled: true }) as never);
    expect(s.soundEffectsEnabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run it; expect failure**

Run: `pnpm --filter @lumio/db exec vitest run src/user-settings.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `packages/db/src/user-settings.ts`**

```ts
import type { PrismaClient } from "@prisma/client";
import { prisma } from "./client.js";

type UserSettingsDb = Pick<PrismaClient, "userSettings">;

export interface UserSettingsDTO {
  soundEffectsEnabled: boolean;
}

/** Get a user's settings, creating the row with defaults on first read. */
export async function getUserSettings(
  userId: string,
  db: UserSettingsDb = prisma,
): Promise<UserSettingsDTO> {
  const row = await db.userSettings.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
  return { soundEffectsEnabled: row.soundEffectsEnabled };
}

/** Persist a partial update; only provided fields are written. */
export async function updateUserSettings(
  userId: string,
  input: Partial<UserSettingsDTO>,
  db: UserSettingsDb = prisma,
): Promise<UserSettingsDTO> {
  const data: { soundEffectsEnabled?: boolean } = {};
  if (input.soundEffectsEnabled !== undefined) data.soundEffectsEnabled = input.soundEffectsEnabled;
  const row = await db.userSettings.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
  return { soundEffectsEnabled: row.soundEffectsEnabled };
}
```

- [ ] **Step 4: Export from the db barrel**

In `packages/db/src/index.ts`:
```ts
export * from "./user-settings.js";
```

- [ ] **Step 5: Run the test; expect pass**

Run: `pnpm --filter @lumio/db exec vitest run src/user-settings.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/user-settings.ts packages/db/src/user-settings.test.ts packages/db/src/index.ts
git commit -m "db: per-user UserSettings get/update"
```

---

## Task 5: Thread `catalogId` through the ingest pipeline

**Files:**
- Modify: `packages/ingest/src/store.ts`, `packages/ingest/src/ingest.ts`, `packages/ingest/src/find-by-hash.ts`
- Test: `packages/ingest/src/store.test.ts` (existing — extend)

- [ ] **Step 1: Write the failing test (extend `store.test.ts`)**

Add to `packages/ingest/src/store.test.ts` a case asserting the composite upsert + catalogId on create. Use the existing test's fake-db shape; the new assertion:
```ts
it("upserts by (catalogId, path) and stores catalogId on create", async () => {
  const calls: any[] = [];
  const db = {
    photo: {
      upsert: async (args: any) => {
        calls.push(args);
        return { id: "p1" };
      },
    },
  };
  await storePhoto(
    { catalogId: "cat1", path: "2024/a.jpg", source: PhotoSource.filesystem, processed: PROCESSED, fileSize: 1, fileMtimeMs: 2, fileBirthtimeMs: 3 },
    { db: db as never, thumbnailsDir: TMP_THUMBS, displaysDir: TMP_DISPLAYS },
  );
  expect(calls[0].where).toEqual({ catalogId_path: { catalogId: "cat1", path: "2024/a.jpg" } });
  expect(calls[0].create.catalogId).toBe("cat1");
});
```
(Reuse/declare `PROCESSED`, `TMP_THUMBS`, `TMP_DISPLAYS` consistent with the existing test file; if the file lacks them, add a minimal `ProcessedPhoto` fixture and `os.tmpdir()` paths.)

- [ ] **Step 2: Run it; expect failure**

Run: `pnpm --filter @lumio/ingest exec vitest run src/store.test.ts`
Expected: FAIL — `catalogId` not accepted / `where.path` used instead of composite.

- [ ] **Step 3: Update `store.ts`**

Add `catalogId` to `StoreInput` and switch the upsert to the composite unique:
```ts
export interface StoreInput {
  catalogId: string;
  path: string; // relative to the catalog root
  source: PhotoSource;
  processed: ProcessedPhoto;
  fileSize: number;
  fileMtimeMs: number;
  fileBirthtimeMs: number;
}
```
In `storePhoto`, destructure `catalogId`, and change the upsert:
```ts
const row = await deps.db.photo.upsert({
  where: { catalogId_path: { catalogId, path: relPath } },
  create: { catalogId, path: relPath, source, ...data },
  update: { ...data, edits: Prisma.JsonNull },
  select: { id: true },
});
```
(`thumbnailsDir`/`displaysDir` in `StoreDeps` are now the *per-catalog* cache dirs — the caller supplies them; no change to `StoreDeps` shape.)

- [ ] **Step 4: Update `ingest.ts` (`IngestDeps`, `RemoveDeps`, lookups)**

```ts
export interface IngestDeps {
  db: Pick<PrismaClient, "photo">;
  catalogId: string;
  thumbnailsDir: string;
  displaysDir: string;
  photosDir: string; // the catalog root
}
// in ingestPath: pass catalogId into storePhoto input:
return storePhoto(
  { catalogId: deps.catalogId, path: relPath, source, processed, fileSize: st.size, fileMtimeMs: st.mtimeMs, fileBirthtimeMs: st.birthtimeMs },
  { db: deps.db, thumbnailsDir: deps.thumbnailsDir, displaysDir: deps.displaysDir },
);

export interface RemoveDeps {
  db: Pick<PrismaClient, "photo">;
  catalogId: string;
  thumbnailsDir: string;
  displaysDir: string;
  editedDisplaysDir: string;
}
// in removePath: look up by composite unique:
const found = await deps.db.photo.findUnique({
  where: { catalogId_path: { catalogId: deps.catalogId, path: relPath } },
  select: { id: true },
});
```

- [ ] **Step 5: Update `find-by-hash.ts` to scope by catalog**

```ts
export async function findPhotoByHash(
  catalogId: string,
  hash: string,
  db: Pick<PrismaClient, "photo">,
): Promise<{ id: string } | null> {
  return db.photo.findFirst({ where: { catalogId, hash }, select: { id: true } });
}
```
(Its only caller is the uploads route, rewired in Phase 2 — the signature change is expected to leave that one web call site red until then.)

- [ ] **Step 6: Run ingest tests; expect pass**

Run: `pnpm --filter @lumio/ingest test`
Expected: PASS (the new assertion + existing ingest tests; update any existing `store`/`ingest` test fixtures that construct `StoreInput`/`IngestDeps` to include `catalogId`).

- [ ] **Step 7: Commit**

```bash
git add packages/ingest/src
git commit -m "ingest: scope store/ingest/remove/find-by-hash by catalogId"
```

---

## Task 6: Catalog-aware worker paths/config

**Files:**
- Modify: `apps/worker/src/config.ts`, `apps/worker/src/bench.ts`, `apps/worker/src/seed.ts`
- Test: `apps/worker/src/config.test.ts` (extend)

- [ ] **Step 1: Write the failing test (extend `config.test.ts`)**

```ts
import { catalogCacheDirs, thumbnailPath } from "./config.js";

describe("per-catalog cache paths", () => {
  it("nests cache under the catalog id", () => {
    const dirs = catalogCacheDirs("cat1");
    expect(dirs.thumbnailsDir.endsWith("/cat1/thumbnails")).toBe(true);
    expect(dirs.displaysDir.endsWith("/cat1/displays")).toBe(true);
    expect(dirs.editedDisplaysDir.endsWith("/cat1/displays-edited")).toBe(true);
  });
  it("thumbnailPath includes catalog id and photo id", () => {
    expect(thumbnailPath("cat1", "p9").endsWith("/cat1/thumbnails/p9.webp")).toBe(true);
  });
});
```

- [ ] **Step 2: Run it; expect failure**

Run: `pnpm --filter @lumio/worker exec vitest run src/config.test.ts`
Expected: FAIL — `catalogCacheDirs` not exported / `thumbnailPath` arity.

- [ ] **Step 3: Update `config.ts`**

Remove the `PHOTOS_DIR` export. Keep `CACHE_DIR`/`TRASH_DIR` roots. Replace the global `THUMBNAILS_DIR`/`DISPLAYS_DIR`/`EDITED_DISPLAYS_DIR` constants and the id-only path helpers with catalog-aware versions:
```ts
export interface CatalogCacheDirs {
  thumbnailsDir: string;
  displaysDir: string;
  editedDisplaysDir: string;
}

export function catalogCacheDirs(catalogId: string): CatalogCacheDirs {
  const base = path.join(CACHE_DIR, catalogId);
  return {
    thumbnailsDir: path.join(base, "thumbnails"),
    displaysDir: path.join(base, "displays"),
    editedDisplaysDir: path.join(base, "displays-edited"),
  };
}

export function thumbnailPath(catalogId: string, id: string): string {
  return path.join(CACHE_DIR, catalogId, "thumbnails", `${id}.webp`);
}
export function displayPath(catalogId: string, id: string): string {
  return path.join(CACHE_DIR, catalogId, "displays", `${id}.webp`);
}
export function editedDisplayPath(catalogId: string, id: string): string {
  return path.join(CACHE_DIR, catalogId, "displays-edited", `${id}.webp`);
}
```

- [ ] **Step 4: De-`PHOTOS_DIR` the dev tools**

In `bench.ts` and `seed.ts`, replace the `PHOTOS_DIR` import with a directory taken from `process.argv[2]` (these are manual dev tools, not part of the catalog flow):
```ts
const TARGET_DIR = process.argv[2] ?? path.resolve(process.cwd(), "photos");
```
and use `TARGET_DIR` wherever `PHOTOS_DIR` was referenced. Update each file's header comment to note the dir is now an argument.

- [ ] **Step 5: Run config tests; expect pass**

Run: `pnpm --filter @lumio/worker exec vitest run src/config.test.ts`
Expected: PASS. (Other worker files won't compile yet — fixed in Tasks 7–9.)

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/config.ts apps/worker/src/config.test.ts apps/worker/src/bench.ts apps/worker/src/seed.ts
git commit -m "worker: per-catalog cache path helpers; drop PHOTOS_DIR"
```

---

## Task 7: Per-catalog dep factories

**Files:**
- Modify: `apps/worker/src/deps.ts`

- [ ] **Step 1: Rewrite `deps.ts` as catalog-keyed factories**

```ts
import { prisma } from "@lumio/db";
import type { IngestDeps, RegenerateDeps, RemoveDeps } from "@lumio/ingest";
import { catalogCacheDirs } from "./config.js";

/** Ingest/regenerate deps for one catalog: per-catalog cache dirs + the catalog root. */
export function ingestDepsFor(catalog: { id: string; path: string }): IngestDeps & RegenerateDeps {
  const { thumbnailsDir, displaysDir, editedDisplaysDir } = catalogCacheDirs(catalog.id);
  return {
    db: prisma,
    catalogId: catalog.id,
    photosDir: catalog.path,
    thumbnailsDir,
    displaysDir,
    editedDisplaysDir,
  };
}

export function removeDepsFor(catalog: { id: string }): RemoveDeps {
  const { thumbnailsDir, displaysDir, editedDisplaysDir } = catalogCacheDirs(catalog.id);
  return { db: prisma, catalogId: catalog.id, thumbnailsDir, displaysDir, editedDisplaysDir };
}
```
(`RegenerateDeps` does not need `catalogId`; including it is harmless since `regenerateRenditions` ignores extra props. Verify `RegenerateDeps`'s required fields are a subset of the above.)

- [ ] **Step 2: Typecheck the file in isolation**

Run: `pnpm --filter @lumio/worker exec tsc --noEmit src/deps.ts 2>&1 | head` (informational — full worker typecheck passes after Task 9).

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/deps.ts
git commit -m "worker: per-catalog ingest/remove dep factories"
```

---

## Task 8: Per-catalog scan

**Files:**
- Modify: `apps/worker/src/scan.ts`

- [ ] **Step 1: Rework `scan.ts` to operate per catalog**

Key changes (keep the pure `planScan`/`planAfterHash`/`reconcileDeletions` and the `ScanSummary` shape unchanged):

1. `listImages(rootDir: string)` takes the catalog root instead of the global `PHOTOS_DIR`.
2. `SCAN_SELECT` gains `catalogId: true`; add `catalogId: string` to `ScanRow`.
3. `cachePresent`, `heal`, `reconcileFile` take a `catalog: { id: string; path: string }` so cache paths resolve via `thumbnailPath(catalog.id, id)` etc. and `absPath = path.join(catalog.path, relPath)`.
4. `reconcileFile` uses `ingestDepsFor(catalog)`; `heal` uses the same.
5. New `scanCatalog(catalog, onProgress?)` = today's `scanAndIngest` body but scoped: load existing rows with `where: { catalogId: catalog.id }`, list from `catalog.path`, remove with `removeDepsFor(catalog)`.
6. New `scanAllCatalogs(onProgress?)` loads all catalogs and runs `scanCatalog` for each, summing summaries.

Representative new signatures + the scoped existing-rows load:
```ts
import { prisma, listCatalogs } from "@lumio/db";
import { ingestDepsFor, removeDepsFor } from "./deps.js";
import { catalogCacheDirs, thumbnailPath, displayPath, editedDisplayPath, INGEST_CONCURRENCY } from "./config.js";

async function listImages(rootDir: string): Promise<string[]> {
  const entries = await readdir(rootDir, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && SUPPORTED_EXTENSIONS.has(path.extname(e.name).toLowerCase()))
    .map((e) => path.relative(rootDir, path.join(e.parentPath, e.name)));
}

export async function reconcileFile(
  catalog: { id: string; path: string },
  relPath: string,
  row: ScanRow | undefined,
  summary: ScanSummary,
): Promise<void> {
  const absPath = path.join(catalog.path, relPath);
  // ...cachePresent(catalog.id, row.id, ...), heal via ingestDepsFor(catalog),
  //    ingestPath(relPath, ingestDepsFor(catalog)) ...
}

export async function scanCatalog(
  catalog: { id: string; path: string },
  onProgress?: (done: number, total: number) => void,
): Promise<ScanSummary> {
  const relPaths = await listImages(catalog.path);
  const existing = await prisma.photo.findMany({ where: { catalogId: catalog.id }, select: SCAN_SELECT });
  // ...same pool/reconcile/delete loop as before, scoped to this catalog...
}

export async function scanAllCatalogs(
  onProgress?: (done: number, total: number) => void,
): Promise<ScanSummary> {
  const catalogs = await listCatalogs();
  const total: ScanSummary = { processed: 0, skipped: 0, skippedUnchanged: 0, healed: 0, restamped: 0, removed: 0 };
  for (const c of catalogs) {
    const s = await scanCatalog(c);
    for (const k of Object.keys(total) as (keyof ScanSummary)[]) total[k] += s[k];
  }
  return total;
}
```
`cachePresent`/`heal`/`refreshStamp` updates: `cachePresent(catalogId, id, edited)` uses `thumbnailPath(catalogId, id)` / `displayPath(catalogId, id)` / `editedDisplayPath(catalogId, id)`; `heal(catalog, row, absPath)` calls `regenerateRenditions(absPath, coercePhotoEdits(row.edits), row.id, ingestDepsFor(catalog))`. `refreshStamp` is unchanged (raw UPDATE by id).

- [ ] **Step 2: Keep the pure-logic tests green**

Run: `pnpm --filter @lumio/worker exec vitest run src/scan.test.ts`
Expected: PASS — `reconcileDeletions`/`planScan`/`planAfterHash` are unchanged. If a test imported the removed `scanAndIngest`, update it to `scanCatalog`/`scanAllCatalogs`.

- [ ] **Step 3: Commit**

```bash
git add apps/worker/src/scan.ts apps/worker/src/scan.test.ts
git commit -m "worker: scan each catalog under its own root + cache subtree"
```

---

## Task 9: Multi-root watch + reconcile loop

**Files:**
- Create: `apps/worker/src/catalog-routing.ts`, `apps/worker/src/catalog-routing.test.ts`
- Modify: `apps/worker/src/watch.ts`

- [ ] **Step 1: Write the failing test for `catalogForPath`**

`apps/worker/src/catalog-routing.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { catalogForPath } from "./catalog-routing.js";

const cats = [
  { id: "a", path: "/media/family" },
  { id: "b", path: "/media/family/2024" }, // nested-looking; longest prefix wins
  { id: "c", path: "/media/trips" },
];

describe("catalogForPath", () => {
  it("matches the catalog whose root contains the file", () => {
    expect(catalogForPath(cats, "/media/trips/a.jpg")?.id).toBe("c");
  });
  it("prefers the longest matching root", () => {
    expect(catalogForPath(cats, "/media/family/2024/a.jpg")?.id).toBe("b");
    expect(catalogForPath(cats, "/media/family/old/a.jpg")?.id).toBe("a");
  });
  it("returns undefined when no root matches", () => {
    expect(catalogForPath(cats, "/etc/passwd")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it; expect failure**

Run: `pnpm --filter @lumio/worker exec vitest run src/catalog-routing.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `catalog-routing.ts`**

```ts
import path from "node:path";

/** The catalog whose root is the longest path-prefix of `absPath`, or undefined. */
export function catalogForPath<T extends { path: string }>(
  catalogs: readonly T[],
  absPath: string,
): T | undefined {
  let best: T | undefined;
  let bestLen = -1;
  const probe = absPath.endsWith(path.sep) ? absPath : absPath + path.sep;
  for (const c of catalogs) {
    const root = c.path.endsWith(path.sep) ? c.path : c.path + path.sep;
    if (probe.startsWith(root) && c.path.length > bestLen) {
      best = c;
      bestLen = c.path.length;
    }
  }
  return best;
}
```

- [ ] **Step 4: Run it; expect pass**

Run: `pnpm --filter @lumio/worker exec vitest run src/catalog-routing.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Rewrite `watch.ts` for all catalogs + a reconcile loop**

Replace the single-root watcher with one that watches every catalog root and reconciles its watch set on an interval. Sketch:
```ts
import { listCatalogs, prisma } from "@lumio/db";
import { catalogForPath } from "./catalog-routing.js";
import { ingestDepsFor, removeDepsFor } from "./deps.js";
import { scanCatalog, SCAN_SELECT, reconcileFile, type ScanSummary } from "./scan.js";

export async function startWatcher(signal: AbortSignal): Promise<FSWatcher> {
  let catalogs = await listCatalogs();
  for (const c of catalogs) await scanCatalog(c); // initial per-catalog scan

  const watcher = chokidar.watch(catalogs.map((c) => c.path), {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
  });

  const upsert = async (abs: string) => {
    if (!isSupported(abs)) return;
    const catalog = catalogForPath(catalogs, abs);
    if (!catalog) return;
    const rel = path.relative(catalog.path, abs);
    activity.importing++;
    try {
      const row = await prisma.photo.findUnique({
        where: { catalogId_path: { catalogId: catalog.id, path: rel } },
        select: SCAN_SELECT,
      });
      const summary = emptySummary();
      await reconcileFile(catalog, rel, row ?? undefined, summary);
      // ...logging unchanged...
    } finally {
      activity.importing--;
    }
  };

  watcher.on("add", upsert).on("change", upsert).on("unlink", async (abs) => {
    if (!isSupported(abs)) return;
    const catalog = catalogForPath(catalogs, abs);
    if (!catalog) return;
    const rel = path.relative(catalog.path, abs);
    await removePath(rel, removeDepsFor(catalog));
  }).on("error", (err) => console.error(`watcher error: ${String(err)}`));

  // Reconcile loop: pick up catalogs created/deleted in-app without a restart.
  const reconcile = setInterval(async () => {
    const next = await listCatalogs();
    const added = next.filter((n) => !catalogs.some((c) => c.id === n.id));
    const removed = catalogs.filter((c) => !next.some((n) => n.id === c.id));
    for (const c of added) { await scanCatalog(c); watcher.add(c.path); }
    for (const c of removed) watcher.unwatch(c.path);
    catalogs = next;
  }, 5000);

  signal.addEventListener("abort", () => { clearInterval(reconcile); void watcher.close(); }, { once: true });
  return watcher;
}
```
Note: `reconcileFile` is now called with `(catalog, rel, row, summary)` per Task 8.

- [ ] **Step 6: Run the worker test suite**

Run: `pnpm --filter @lumio/worker test`
Expected: PASS (pure tests for scan/config/pool/format/catalog-routing). Confirm `apps/worker` typechecks: `pnpm --filter @lumio/worker typecheck 2>&1 | grep 'error TS' | grep -v calendar.ts` → empty.

- [ ] **Step 7: Commit**

```bash
git add apps/worker/src/catalog-routing.ts apps/worker/src/catalog-routing.test.ts apps/worker/src/watch.ts
git commit -m "worker: watch all catalog roots; route events by longest prefix; reconcile loop"
```

---

## Task 10: Catalog-scoped jobs + handlers

**Files:**
- Modify: `packages/jobs/src/purge.ts`, `apps/worker/src/handlers.ts`
- Test: `packages/jobs/src/purge.test.ts` (if present — else add), `apps/worker/src/handlers.test.ts`

- [ ] **Step 1: Write the failing test for catalog-scoped purge**

In `packages/jobs/src/purge.test.ts`, assert `purgeAllPhotos` filters by `catalogId` and removes from the per-catalog cache dir:
```ts
it("purges only the given catalog's photos and cache", async () => {
  const deleted: any[] = [];
  const db = {
    photo: {
      findMany: async (a: any) => { deleted.push(a.where); return [{ id: "p1", path: "a.jpg" }]; },
      deleteMany: async (a: any) => ({ count: 1 }),
    },
  };
  const res = await purgeAllPhotos({ db: db as never, catalogId: "cat1", photosDir: "/media/c1", cacheDir: "/cache/cat1" });
  expect(deleted[0]).toEqual({ catalogId: "cat1" });
  expect(res.deleted).toBe(1);
});
```

- [ ] **Step 2: Run it; expect failure**

Run: `pnpm --filter @lumio/jobs exec vitest run src/purge.test.ts`
Expected: FAIL — `catalogId` not on `PurgeAllDeps` / `findMany` unscoped.

- [ ] **Step 3: Update `purge.ts`**

```ts
export interface PurgeAllDeps {
  db: Pick<PrismaClient, "photo">;
  catalogId: string;
  photosDir: string; // catalog root
  cacheDir: string;  // per-catalog cache base (cache/<catalogId>)
}

export async function purgeAllPhotos(deps: PurgeAllDeps): Promise<{ deleted: number }> {
  const photos = await deps.db.photo.findMany({
    where: { catalogId: deps.catalogId },
    select: { id: true, path: true },
  });
  await Promise.all(
    photos.flatMap((p) => [
      rm(path.join(deps.photosDir, p.path), { force: true }),
      rm(path.join(deps.cacheDir, "thumbnails", `${p.id}.webp`), { force: true }),
      rm(path.join(deps.cacheDir, "displays", `${p.id}.webp`), { force: true }),
    ]),
  );
  const { count } = await deps.db.photo.deleteMany({ where: { catalogId: deps.catalogId } });
  return { deleted: count };
}
```
Do the same scoping for `purgeTrash` (add `catalogId` to `PurgeTrashDeps`, filter `where` by it, use the per-catalog `trashDir`).

- [ ] **Step 4: Update `handlers.ts` to be catalog-scoped**

The job consumer now passes the job's `catalogId` to the handler. `defaultDeps` becomes a factory keyed by catalog:
```ts
import { getCatalogById } from "@lumio/db";
import { catalogCacheDirs, CACHE_DIR, TRASH_DIR } from "./config.js";
import { scanCatalog } from "./scan.js";

function depsForCatalog(catalogId: string): HandlerDeps {
  return {
    scan: async (onProgress) => {
      const catalog = await getCatalogById(catalogId);
      if (catalog) await scanCatalog(catalog, onProgress);
    },
    purgeAll: async () => {
      const catalog = await getCatalogById(catalogId);
      if (!catalog) return { deleted: 0 };
      return purgeAllPhotos({ db: prisma, catalogId, photosDir: catalog.path, cacheDir: path.join(CACHE_DIR, catalogId) });
    },
    emptyTrash: () => purgeTrash(undefined, { db: prisma, catalogId, trashDir: path.join(TRASH_DIR, catalogId) }),
  };
}

export function buildHandlers(makeDeps: (catalogId: string) => HandlerDeps = depsForCatalog): Required<JobHandlers> {
  // each handler reads the job's catalogId and calls makeDeps(catalogId)
}
```
Adjust the `JobHandlers` call signature so handlers receive the job (with `catalogId`). If the `@lumio/jobs` consumer types don't already pass `catalogId` to the handler, thread it through there too (smallest change: the consumer passes the `Job` row; the handler reads `job.catalogId`). Update `handlers.test.ts` to pass a fake `makeDeps` and a job with a `catalogId`.

- [ ] **Step 5: Run jobs + handler tests; expect pass**

Run: `pnpm --filter @lumio/jobs test && pnpm --filter @lumio/worker exec vitest run src/handlers.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/jobs/src apps/worker/src/handlers.ts apps/worker/src/handlers.test.ts
git commit -m "jobs/worker: scope rescan/purge/empty-trash to a catalogId"
```

---

## Task 11: Backend green-check + manual worker smoke

**Files:** none (verification)

- [ ] **Step 1: Run all backend package tests**

Run: `pnpm --filter @lumio/shared --filter @lumio/db --filter @lumio/ingest --filter @lumio/jobs --filter @lumio/worker test`
Expected: all PASS.

- [ ] **Step 2: Typecheck the backend packages**

Run: `for p in shared db ingest jobs; do pnpm --filter @lumio/$p typecheck; done 2>&1 | grep 'error TS' | grep -v calendar.ts` and `pnpm --filter @lumio/worker typecheck 2>&1 | grep 'error TS' | grep -v calendar.ts`
Expected: empty output (only the known `calendar.ts` errors are tolerated). `apps/web` is expected to be red — do not check it here.

- [ ] **Step 3: Manual smoke — index a real catalog**

With the migration applied, insert one catalog pointing at the dev photos dir and run the watcher:
```bash
docker exec infra-db-1 psql -U lumio -d lumio -c \
  "INSERT INTO \"Catalog\" (id, name, slug, path, \"updatedAt\") VALUES ('smoke1','Smoke','smoke','<ABS_PHOTOS_DIR>', now());"
pnpm --filter @lumio/worker watch   # let the initial scan run, then Ctrl-C
docker exec infra-db-1 psql -U lumio -d lumio -c \
  "SELECT count(*) FROM \"Photo\" WHERE \"catalogId\"='smoke1';"
```
Expected: the photo count matches the image files under `<ABS_PHOTOS_DIR>`, and `cache/smoke1/thumbnails/` is populated. (Coordinate `<ABS_PHOTOS_DIR>` with the user — it's the shared dev photos dir.)

- [ ] **Step 4: Commit any smoke-fix tweaks, then stop**

This completes Phase 1. Phase 2 (API: `/api/c/[catalog]/…`, catalog CRUD + folder-browser endpoints, query scoping) is the next plan.

---

## Self-Review notes (addressed)

- **Spec coverage:** schema (Catalog/UserSettings/catalogId/composite unique) ✓; per-catalog cache/trash paths ✓; worker watches all catalogs + reconcile ✓; catalog-scoped jobs ✓; slug identity ✓. Deferred to later phases by design: API nesting, page routing, settings-reorg/`AppSettings` retirement, folder browser, setup gate, `MEDIA_ROOT` (web).
- **Placeholders:** none — every code/test step shows real code.
- **Type consistency:** `catalogId` is the property name throughout; composite key is `catalogId_path` (Prisma's generated name for `@@unique([catalogId, path])`); `ingestDepsFor`/`removeDepsFor`/`scanCatalog`/`scanAllCatalogs`/`catalogForPath` names are used consistently across Tasks 5–10.
- **Known intentional red:** `apps/web` does not type-check after this phase (album/folder create + uploads + settings still call pre-catalog signatures) — fixed in Phases 2–3.
