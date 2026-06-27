# File Extension Storage & Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store each photo's file extension as an indexed `Photo.extension` column (populated at ingest/upload, backfilled from `path`) and let users filter the grid by it via an always-on "File type" facet.

**Architecture:** Extension is a **built-in system field**, not user metadata. One shared `fileExtension()` helper feeds `storePhoto` (covering filesystem ingest *and* upload). The static `FIELD_REGISTRY` gains an `extension` column field; a `SYSTEM_FIELD_KEYS` allowlist lets the per-catalog search gate admit *only* extension (not the rest of the EXIF registry). The search UI reuses the existing `FacetMultiselect` (emits `in_list` rules) backed by a `distinctExtensions` query + `/extensions` route.

**Tech Stack:** TypeScript, Prisma (Postgres on :5433), vitest, Next.js (App Router), pnpm workspaces (`@lumio/shared`, `@lumio/db`, `@lumio/ingest`, `@lumio/web`).

**Spec:** `docs/superpowers/specs/2026-06-27-file-extension-storage-and-search-design.md`

**Conventions:**
- Run a single test file with: `pnpm --filter <pkg> test <path>` (e.g. `pnpm --filter @lumio/shared test src/formats.test.ts`).
- Commit after each task.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/shared/src/formats.ts` | `fileExtension()` — normalize an ext from a name/path |
| `packages/db/prisma/schema.prisma` | `Photo.extension` column + index |
| `packages/db/prisma/migrations/20260627120000_add_photo_extension/migration.sql` | add column + backfill + index |
| `packages/ingest/src/store.ts` | write `extension` on upsert |
| `packages/shared/src/filters.ts` | `extension` `FIELD_REGISTRY` entry + `SYSTEM_FIELD_KEYS` |
| `packages/db/src/search.ts` | gate admits system fields |
| `packages/db/src/extensions.ts` | `distinctExtensions(catalogId)` |
| `packages/db/src/index.ts` | export `distinctExtensions` |
| `apps/web/src/app/api/c/[catalog]/extensions/route.ts` | distinct-extensions endpoint |
| `apps/web/src/app/(app)/c/[catalog]/search/use-extensions.ts` | client hook fetching the endpoint |
| `apps/web/src/app/(app)/c/[catalog]/search/file-type-facet.tsx` | "File type" facet (wraps `FacetMultiselect`) |
| `apps/web/src/app/(app)/c/[catalog]/search/filter-panel.tsx` | render the facet + show panel when extensions exist |

---

## Task 1: `fileExtension()` shared helper

**Files:**
- Modify: `packages/shared/src/formats.ts`
- Test: `packages/shared/src/formats.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/shared/src/formats.test.ts` (update the import on line 2 to `import { fileExtension, isSupportedImage } from "./formats.js";`):

```ts
describe("fileExtension", () => {
  it("returns the last extension, lowercased, without the dot", () => {
    expect(fileExtension("a.JPG")).toBe("jpg");
    expect(fileExtension("dir/sub/b.heic")).toBe("heic");
    expect(fileExtension("IMG_001.CR2")).toBe("cr2");
    expect(fileExtension("archive.tar.gz")).toBe("gz");
  });
  it("returns '' when there is no usable extension", () => {
    expect(fileExtension("README")).toBe("");
    expect(fileExtension(".gitignore")).toBe(""); // dotfile, no name
    expect(fileExtension("photo.")).toBe(""); // trailing dot
    expect(fileExtension("dir.with.dots/name")).toBe(""); // dot only in a parent dir
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lumio/shared test src/formats.test.ts`
Expected: FAIL — `fileExtension is not a function` / not exported.

- [ ] **Step 3: Write minimal implementation**

Add to `packages/shared/src/formats.ts` (below `isSupportedImage`):

```ts
/**
 * The last ".xxx" segment of a filename or path, lowercased, without the dot.
 * Returns "" when there is none (no dot, dotfile like ".gitignore", trailing
 * dot, or a dot only in a parent directory). Pure string op (no fs) so the
 * browser, ingest pipeline, and tests share one definition.
 */
export function fileExtension(nameOrPath: string): string {
  const base = nameOrPath.slice(nameOrPath.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return ""; // no dot, or leading-dot dotfile
  return base.slice(dot + 1).toLowerCase();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lumio/shared test src/formats.test.ts`
Expected: PASS (both `isSupportedImage` and `fileExtension` suites green).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/formats.ts packages/shared/src/formats.test.ts
git commit -m "feat(shared): add fileExtension() helper"
```

---

## Task 2: `Photo.extension` column + backfill migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260627120000_add_photo_extension/migration.sql`

> ⚠️ **Shared dev DB.** All worktrees share one Postgres (:5433). This migration is **additive** (add column + backfill + index) and safe. If any Prisma command offers to **reset** the database, **decline** — never reset or wipe. Other branches' unmerged migrations may look like "drift"; ignore them.

- [ ] **Step 1: Add the column to the schema**

In `packages/db/prisma/schema.prisma`, inside `model Photo`, add the field next to the other file-metadata columns (e.g. after `fileCreatedAt`):

```prisma
  extension       String   @default("") // literal ext, lowercased, no dot: "cr2", "jpeg"; "" = none
```

And add the index alongside the model's other `@@index(...)` lines:

```prisma
  @@index([catalogId, extension])
```

- [ ] **Step 2: Hand-author the migration SQL**

Create `packages/db/prisma/migrations/20260627120000_add_photo_extension/migration.sql`:

```sql
-- AddPhotoExtension
ALTER TABLE "Photo" ADD COLUMN "extension" TEXT NOT NULL DEFAULT '';

-- Backfill from the stored relative path: chars after the final dot, excluding
-- dots/slashes, anchored to end-of-string. substring() is NULL when there is no
-- extension; COALESCE keeps the NOT NULL column valid.
UPDATE "Photo" SET "extension" = COALESCE(lower(substring("path" from '\.([^./]+)$')), '');

CREATE INDEX "Photo_catalogId_extension_idx" ON "Photo"("catalogId", "extension");
```

(The index name **must** be exactly `Photo_catalogId_extension_idx` — Prisma's default name for `@@index([catalogId, extension])` — or a later `migrate dev` will report drift.)

- [ ] **Step 3: Apply the migration + regenerate the client**

Run:
```bash
cd packages/db && dotenv -e ../../.env -- prisma migrate deploy
```
Expected: `Applying migration 20260627120000_add_photo_extension` then `migrations applied`. `migrate deploy` is non-interactive (no reset prompt) and only applies pending migrations.

Then regenerate the typed client so `extension` exists on `Photo`:
```bash
cd ../.. && pnpm --filter @lumio/db generate
```

- [ ] **Step 4: Verify it applied + backfilled**

Run: `cd packages/db && dotenv -e ../../.env -- prisma migrate status`
Expected: `Database schema is up to date!` and `20260627120000_add_photo_extension` listed as applied.

(Optional spot-check of the backfill, if `psql` is available:)
```bash
dotenv -e ../../.env -- prisma db execute --stdin <<'SQL'
SELECT extension, count(*) FROM "Photo" GROUP BY extension ORDER BY count(*) DESC LIMIT 10;
SQL
```
Expected: rows like `jpg | N`, `heic | M` — not all empty.

- [ ] **Step 5: Commit**

```bash
cd ../.. && git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260627120000_add_photo_extension
git commit -m "feat(db): add Photo.extension column + backfill migration"
```

---

## Task 3: Populate `extension` in `storePhoto`

**Files:**
- Modify: `packages/ingest/src/store.ts`
- Test: `packages/ingest/src/store.test.ts`

- [ ] **Step 1: Write the failing test**

Append this test inside the `describe("storePhoto", ...)` block in `packages/ingest/src/store.test.ts`:

```ts
  it("derives the file extension from the path (lowercased) on create and update", async () => {
    const db = fakeDb("p-ext");
    await storePhoto(
      {
        catalogId: "cat1",
        path: "vacation/IMG_001.CR2",
        source: PhotoSource.filesystem,
        processed,
        fileSize: 1,
        fileMtimeMs: 1,
        fileBirthtimeMs: 1700000000000,
      },
      { db: db as never, thumbnailsDir: path.join(dir, "text"), displaysDir: path.join(dir, "dext") },
    );
    const args = db.calls[0] as { create: Record<string, unknown>; update: Record<string, unknown> };
    expect(args.create.extension).toBe("cr2");
    expect(args.update.extension).toBe("cr2");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lumio/ingest test src/store.test.ts`
Expected: FAIL — `expected undefined to be "cr2"`.

- [ ] **Step 3: Write minimal implementation**

In `packages/ingest/src/store.ts`:

Update the import on line 4 to add `fileExtension`:
```ts
import { derivePromotedFields, fileExtension, parentDir, type PhotoSource } from "@lumio/shared";
```

Add one line to the `data` object (e.g. right after `dirPath: parentDir(relPath),`):
```ts
    // Literal file extension (lowercased, no dot) for type filtering/search.
    // Derived from the path, so it lands on both create and update.
    extension: fileExtension(relPath),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lumio/ingest test src/store.test.ts`
Expected: PASS (all storePhoto tests green).

- [ ] **Step 5: Commit**

```bash
git add packages/ingest/src/store.ts packages/ingest/src/store.test.ts
git commit -m "feat(ingest): store file extension on every photo upsert"
```

---

## Task 4: Register `extension` as a system field

**Files:**
- Modify: `packages/shared/src/filters.ts`
- Test: `packages/shared/src/filters.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/shared/src/filters.test.ts`. Ensure the file imports `resolveField`, `RuleOp`, and `SYSTEM_FIELD_KEYS` (add to the existing imports from `./filters.js` / `./enums.js` as needed):

```ts
describe("extension system field", () => {
  it("resolves a column-backed extension field with in_list ops and ext/filetype aliases", () => {
    const def = resolveField("extension");
    expect(def.key).toBe("extension");
    expect(def.storage).toEqual({ kind: "column", column: "extension" });
    expect(def.ops).toContain(RuleOp.in_list);
    expect(def.ops).toContain(RuleOp.not_in_list);
    expect(resolveField("ext").key).toBe("extension");
    expect(resolveField("filetype").key).toBe("extension");
  });
  it("is in the system-field allowlist", () => {
    expect(SYSTEM_FIELD_KEYS.has("extension")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lumio/shared test src/filters.test.ts`
Expected: FAIL — `SYSTEM_FIELD_KEYS` undefined / `resolveField("extension")` returns a generic `exif.extension` def.

- [ ] **Step 3: Write minimal implementation**

In `packages/shared/src/filters.ts`, add an `extension` entry to `FIELD_REGISTRY` (alongside `filename`):

```ts
  extension: { key: "extension", label: "File type", type: ValueType.string, storage: { kind: "column", column: "extension" }, ops: [RuleOp.eq, RuleOp.ne, RuleOp.in_list, RuleOp.not_in_list], aliases: ["ext", "filetype"] },
```

Then add the allowlist export below the registry (after the `FIELD_REGISTRY` object literal):

```ts
/**
 * Built-in "system" fields admitted through the per-catalog search gate even when
 * they are not part of a catalog's metadata schema. These are hard file facts the
 * user never configures (vs. user-curated metadata fields). Keep this set tight —
 * it deliberately does NOT open the whole FIELD_REGISTRY to the search page.
 */
export const SYSTEM_FIELD_KEYS = new Set<string>(["extension"]);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lumio/shared test src/filters.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/filters.ts packages/shared/src/filters.test.ts
git commit -m "feat(shared): register extension as a built-in system search field"
```

---

## Task 5: Admit system fields through the search gate

**Files:**
- Modify: `packages/db/src/search.ts`
- Test: `packages/db/src/search.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/db/src/search.test.ts`:

```ts
describe("buildSearchWhere — extension system field", () => {
  const reg: SearchRegistry = new Map<string, FieldDef>([
    ["film", { key: "film", label: "Film", type: ValueType.string, storage: { kind: "metadata", fieldId: "f1" }, ops: [] }],
  ]);
  const NOW = new Date("2026-06-27T00:00:00Z");

  it("admits an extension in_list rule through the gate even when it is not a metadata field", () => {
    const where = buildSearchWhere(
      { album: [], filter: { match: MatchType.all, rules: [{ field: "extension", op: RuleOp.in_list, value: ["cr2", "jpeg"] }] } },
      NOW,
      reg,
    );
    expect(where).toEqual({ AND: [{ extension: { in: ["cr2", "jpeg"] } }] });
  });

  it("drops an extension rule whose op is not allowed (e.g. contains)", () => {
    const where = buildSearchWhere(
      { album: [], filter: { match: MatchType.all, rules: [{ field: "extension", op: RuleOp.contains, value: "cr" }] } },
      NOW,
      reg,
    );
    expect(where).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lumio/db test src/search.test.ts`
Expected: FAIL — the first case returns `{}` (the extension rule is dropped by the gate).

- [ ] **Step 3: Write minimal implementation**

In `packages/db/src/search.ts`:

Update the import on line 2 to add `resolveField` and `SYSTEM_FIELD_KEYS`:
```ts
import { type FilterSet, MatchType, resolveField, SYSTEM_FIELD_KEYS, type SearchRegistry } from "@lumio/shared";
```

Replace the registry filter (the `const filterRules = registry ? ... : ...` block, ~lines 38-43) with:
```ts
  // When a registry is provided, drop user filter rules whose field is neither a
  // configured (registered) metadata field NOR a built-in system field (e.g.
  // `extension`). Legacy album/filename clauses are never dropped — they are
  // engine-internal and not user-supplied field names.
  const filterRules = registry
    ? (p.filter?.rules ?? []).filter((r) => {
        const d = registry.get(r.field) ?? (SYSTEM_FIELD_KEYS.has(r.field) ? resolveField(r.field) : undefined);
        return !!d && (d.ops.length === 0 || d.ops.includes(r.op));
      })
    : (p.filter?.rules ?? []);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lumio/db test src/search.test.ts`
Expected: PASS (the new suite plus all existing `buildSearchWhere` tests green).

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/search.ts packages/db/src/search.test.ts
git commit -m "feat(db): admit built-in system fields through the search gate"
```

---

## Task 6: `distinctExtensions` query

**Files:**
- Create: `packages/db/src/extensions.ts`
- Modify: `packages/db/src/index.ts`
- Test: `packages/db/src/extensions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/extensions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { distinctExtensions } from "./extensions.js";

describe("distinctExtensions", () => {
  it("queries distinct non-empty extensions for LIVE photos, sorted, and maps to strings", async () => {
    const calls: unknown[] = [];
    const db = {
      photo: {
        findMany: async (args: unknown) => {
          calls.push(args);
          return [{ extension: "cr2" }, { extension: "jpg" }];
        },
      },
    };
    const result = await distinctExtensions("cat1", db as never);
    expect(result).toEqual(["cr2", "jpg"]);
    expect(calls[0]).toEqual({
      where: { catalogId: "cat1", trashedAt: null, extension: { not: "" } },
      select: { extension: true },
      distinct: ["extension"],
      orderBy: { extension: "asc" },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lumio/db test src/extensions.test.ts`
Expected: FAIL — cannot find module `./extensions.js`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/db/src/extensions.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import { prisma } from "./client.js";

/**
 * Distinct, non-empty file extensions among LIVE (non-trashed) photos in a
 * catalog, sorted ascending. Powers the "File type" search facet. Uses the
 * @@index([catalogId, extension]).
 */
export async function distinctExtensions(
  catalogId: string,
  db: Pick<PrismaClient, "photo"> = prisma,
): Promise<string[]> {
  const rows = await db.photo.findMany({
    where: { catalogId, trashedAt: null, extension: { not: "" } },
    select: { extension: true },
    distinct: ["extension"],
    orderBy: { extension: "asc" },
  });
  return rows.map((r) => r.extension);
}
```

Add the export to `packages/db/src/index.ts` (next to the other `export *` lines):
```ts
export * from "./extensions.js";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lumio/db test src/extensions.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/extensions.ts packages/db/src/extensions.test.ts packages/db/src/index.ts
git commit -m "feat(db): add distinctExtensions(catalogId) query"
```

---

## Task 7: `/extensions` API route

**Files:**
- Create: `apps/web/src/app/api/c/[catalog]/extensions/route.ts`

(No automated test — Next.js route handlers have no test harness in this repo. Verified via typecheck in Task 9 and the browser in Task 10.)

- [ ] **Step 1: Implement the route**

Create `apps/web/src/app/api/c/[catalog]/extensions/route.ts`:

```ts
import { NextResponse } from "next/server";
import { distinctExtensions } from "@lumio/db";
import { withCatalog } from "@/lib/server/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Distinct file extensions present in the catalog — options for the "File type"
// search facet. Not behind the Metadata feature flag: extension is a core file
// fact, always available.
export const GET = withCatalog(async (_request, _context, { catalog }) => {
  return NextResponse.json({ extensions: await distinctExtensions(catalog.id) });
});
```

- [ ] **Step 2: Verify it compiles**

Run: `pnpm --filter @lumio/web typecheck`
Expected: PASS (no type errors).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/api/c/[catalog]/extensions/route.ts
git commit -m "feat(web): add GET /api/c/[catalog]/extensions"
```

---

## Task 8: "File type" facet + filter-panel wiring

**Files:**
- Create: `apps/web/src/app/(app)/c/[catalog]/search/use-extensions.ts`
- Create: `apps/web/src/app/(app)/c/[catalog]/search/file-type-facet.tsx`
- Modify: `apps/web/src/app/(app)/c/[catalog]/search/filter-panel.tsx`

(No render test — these client components have no harness here; the rule logic they depend on, `applyMultiselect`/`readMultiselect`, is already covered in `panel-rules`. Verified in the browser in Task 10.)

- [ ] **Step 1: Create the data hook**

Create `apps/web/src/app/(app)/c/[catalog]/search/use-extensions.ts`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { catalogApiUrl } from "@/lib/catalog-api";

/** Distinct file extensions present in the catalog (sorted, lowercased, no dot).
 *  Empty while loading or when the catalog has none. */
export function useExtensions(slug: string): string[] {
  const [extensions, setExtensions] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    fetch(catalogApiUrl(slug, "/extensions"))
      .then((r) => (r.ok ? (r.json() as Promise<{ extensions: string[] }>) : { extensions: [] }))
      .then((d) => {
        if (active) setExtensions(d.extensions ?? []);
      })
      .catch(() => {
        if (active) setExtensions([]);
      });
    return () => {
      active = false;
    };
  }, [slug]);
  return extensions;
}
```

- [ ] **Step 2: Create the facet**

Create `apps/web/src/app/(app)/c/[catalog]/search/file-type-facet.tsx`:

```tsx
"use client";

import type { FilterRule } from "@lumio/shared";
import { FacetMultiselect } from "./facet-multiselect";

/** Always-on "File type" facet. Reuses FacetMultiselect, which emits/reads
 *  `in_list` rules on the `extension` system field — no new rule plumbing. */
export function FileTypeFacet({
  extensions,
  rules,
  onRules,
}: {
  extensions: string[];
  rules: FilterRule[];
  onRules: (next: FilterRule[]) => void;
}) {
  if (extensions.length === 0) return null;
  return (
    <FacetMultiselect
      label="File type"
      fieldKey="extension"
      staticOptions={extensions}
      rules={rules}
      onRules={onRules}
    />
  );
}
```

- [ ] **Step 3: Wire it into the filter panel**

Replace the contents of `apps/web/src/app/(app)/c/[catalog]/search/filter-panel.tsx` with:

```tsx
"use client";

import { SlidersHorizontal } from "lucide-react";
import { MatchType } from "@lumio/shared";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { useCatalog } from "@/components/providers/catalog-context";
import { useCatalogMetadataSchema } from "@/features/lightbox/use-metadata-schema";
import type { SearchFilters } from "./filters";
import { MetadataFacets } from "./metadata-facets";
import { FileTypeFacet } from "./file-type-facet";
import { useExtensions } from "./use-extensions";

export function FilterPanel({
  filters,
  onChange,
}: {
  filters: SearchFilters;
  onChange: (next: SearchFilters) => void;
}) {
  const { slug } = useCatalog();
  const schema = useCatalogMetadataSchema(slug);
  const extensions = useExtensions(slug);

  const enabledGroups = (schema ?? [])
    .map((g) => ({ ...g, fields: g.fields.filter((f) => f.enabled) }))
    .filter((g) => g.fields.length > 0);

  // Hide the filter button only when there is nothing to filter on at all —
  // no configured metadata fields AND no file types present.
  if (enabledGroups.length === 0 && extensions.length === 0) return null;

  const activeCount = filters.rules.length;
  const setRules = (rules: SearchFilters["rules"]) => onChange({ ...filters, rules });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline">
          <SlidersHorizontal aria-hidden />
          Filters{activeCount > 0 ? ` (${activeCount})` : ""}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 max-h-[70vh] overflow-y-auto p-4">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-medium">Filters</span>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Match any
            <Switch
              checked={filters.match === MatchType.any}
              onCheckedChange={(any) =>
                onChange({ ...filters, match: any ? MatchType.any : MatchType.all })
              }
            />
          </label>
        </div>
        <div className="space-y-4">
          <FileTypeFacet extensions={extensions} rules={filters.rules} onRules={setRules} />
          {enabledGroups.length > 0 && (
            <MetadataFacets groups={enabledGroups} slug={slug} rules={filters.rules} onRules={setRules} />
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 4: Verify it compiles**

Run: `pnpm --filter @lumio/web typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(app)/c/[catalog]/search/use-extensions.ts" "apps/web/src/app/(app)/c/[catalog]/search/file-type-facet.tsx" "apps/web/src/app/(app)/c/[catalog]/search/filter-panel.tsx"
git commit -m "feat(web): add always-on File type filter facet"
```

---

## Task 9: Full test + typecheck sweep

**Files:** none (verification only)

- [ ] **Step 1: Run all package tests**

Run: `pnpm -r test`
Expected: PASS across `@lumio/shared`, `@lumio/db`, `@lumio/ingest`, `@lumio/web` (no failures introduced).

- [ ] **Step 2: Typecheck the touched packages**

Run:
```bash
pnpm --filter @lumio/shared typecheck && pnpm --filter @lumio/db typecheck && pnpm --filter @lumio/ingest typecheck && pnpm --filter @lumio/web typecheck
```
Expected: PASS (the Prisma client regenerated in Task 2 means `Photo.extension` is known everywhere).

- [ ] **Step 3: Commit (only if anything needed fixing)**

```bash
git commit -am "chore: fix types/tests after extension feature" || echo "nothing to commit"
```

---

## Task 10: Browser verification

**Files:** none (manual verification)

- [ ] **Step 1: Start the app**

Run: `pnpm dev` (Next dev server). Open a catalog that has photos.

- [ ] **Step 2: Verify the facet**

- Open the search **Filters** popover. Confirm a **"File type"** section appears listing the extensions present (e.g. `jpg`, `heic`, `cr2`).
- Check one or more types. Confirm the grid narrows to only those files and the **Filters (N)** badge increments.
- Confirm `GET /api/c/<slug>/extensions` returns `{ "extensions": [...] }` (Network tab).
- Uncheck all → grid returns to the full set.

- [ ] **Step 3: Verify backfill on an existing photo**

Confirm previously-ingested photos (not just newly added ones) appear under their correct file type — proving the migration backfill populated `extension` from `path`.

---

## Self-Review Notes

- **Spec coverage:** §3.1 column+index → Task 2; §3.2 helper → Task 1; §3.3 ingest/upload population → Task 3 (upload flows through `storePhoto`, so it is covered without an upload-service change); §3.4 backfill → Task 2; §3.5 system-field gate → Tasks 4–5; §3.6 facet UI → Tasks 6–8; testing → Tasks 1,3,4,5,6,9,10. Out-of-scope items (info-panel display, "kind" grouping, `@`-autocomplete, MIME) intentionally omitted.
- **Type consistency:** `fileExtension` (Tasks 1,3), `SYSTEM_FIELD_KEYS` (Tasks 4,5), `distinctExtensions(catalogId, db?)` (Tasks 6,7), `useExtensions(slug)` / `FileTypeFacet({extensions,rules,onRules})` (Task 8) are named identically across tasks. The `extension` `FieldDef` ops `[eq, ne, in_list, not_in_list]` match the facet's `in_list` usage and the gate test's `contains`-is-dropped assertion.
- **Index name:** `Photo_catalogId_extension_idx` in the migration matches Prisma's default for `@@index([catalogId, extension])` (verified against existing migrations) — no future drift.
