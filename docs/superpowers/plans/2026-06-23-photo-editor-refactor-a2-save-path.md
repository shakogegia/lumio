# Photo-editor refactor A2 — Save-path unification — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `@lumio/ingest` the single owner of photo-edit rendition writes (centralize the cache-path layout there, then have the web `applyPhotoEdits` delegate to `regenerateRenditions` and do only the DB update), eliminating the duplicated "what files an edit produces and where" logic before the pixi.js rebuild.

**Architecture:** Increment **A2 of Phase A** (spec: `docs/superpowers/specs/2026-06-23-photo-editor-refactor-design.md` §7). Pure backend logic, location-independent (no folder moves, no UI). Three tasks: (1) add env-free cache-path builders to `@lumio/ingest`; (2) point the worker + web path modules at them (dedupe the triplicated layout); (3) refactor web `applyPhotoEdits` to call `regenerateRenditions`. After A2 there is exactly one place that knows the rendition cache layout and one function that writes renditions for an edit.

**Tech Stack:** TypeScript (strict, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`), Vitest, sharp (in ingest). `@lumio/ingest` is node-only (sharp/decoders); `@lumio/shared` is framework-agnostic (which is why the cache-path layout goes in ingest, not shared — the Expo client imports shared and must stay `node:path`-free). Run: `pnpm --filter @lumio/ingest test`, `pnpm -r test`.

**Behavior note (read before Task 3):** Today web `applyPhotoEdits` writes only the thumbnail + edited-display and deliberately does NOT rewrite the edit-free base display. `regenerateRenditions` DOES (re)write the base. After A2, saving an edit re-writes the base display too. This is **user-invisible** — the base is `buildRenditions(originalInput, null)`, deterministic from the unchanged original, so the bytes are identical; `regenerateRenditions` is explicitly designed to reproduce what ingest produced. It is strictly more robust (self-heals a missing/corrupt base) at the cost of one extra webp encode per save. This trade is intended (the dedup + single-writer win is the point); it is documented in the refactored code.

**Spec deviation (documented):** spec §7 said "centralize the rendition path builders into `shared/paths.ts`." This plan puts them in `@lumio/ingest` instead, because `shared` must remain `node:path`-free for the Expo client and the cache layout is an inherently node-only, rendition-owned concern. End state (one home for the layout, consumed by worker + web) is unchanged.

**Scope of A2:** spec §7 (save-path unification + rendition path centralization). **Not in A2:** trash/cache path dedup beyond renditions and the `jobs/purge.ts` literals (Phase B); the folder restructure / component split / `css-preview` extraction (A3); the correctness fixes (A4); adding `server-only` guards (Phase B — noted as a follow-up since A2 makes `web/lib/paths.ts` pull in ingest transitively, but all its importers are already server-only routes).

---

## File structure

| File | Responsibility | Change |
| --- | --- | --- |
| `packages/ingest/src/paths.ts` | **NEW** — env-free per-catalog rendition cache layout | create `CatalogCacheDirs`, `catalogCacheDirs`, `thumbnailPath`, `displayPath`, `editedDisplayPath` (all take `cacheRoot`) |
| `packages/ingest/src/index.ts` | ingest public barrel | export `./paths.js` |
| `packages/ingest/src/paths.test.ts` | **NEW** — unit tests for the layout | pure assertions |
| `apps/worker/src/config.ts` | worker env + cache config | delegate the 4 path builders to ingest (bind `CACHE_DIR`); keep env resolution |
| `apps/web/src/lib/paths.ts` | web server FS paths | delegate the 3 rendition builders to ingest (bind `CACHE_DIR`); **add** `catalogCacheDirs`; keep `trash*`/`originalPath`/`browseDir`/etc. |
| `apps/web/src/lib/photo-edits-service.ts` | web edit save path | call `regenerateRenditions` + do only the DB update |
| `apps/web/src/lib/photo-edits-service.test.ts` | unit test (mocked) | update mocks; add delegation + reset tests |

Consumers whose imports DON'T change (verified): worker `scan.ts`/`deps.ts`/`backfill-thumbhash.ts` (use `config.ts` builders), web `display`/`thumbnail` route handlers (use `@/lib/paths` builders) — all keep identical function names/signatures after the internal delegation.

---

## Task 1: Add env-free cache-path builders to `@lumio/ingest`

Spec §7 (path centralization). The cache layout `<root>/<catalogId>/{thumbnails,displays,displays-edited}/<id>.webp` is currently reimplemented in `apps/worker/src/config.ts` and `apps/web/src/lib/paths.ts`. Move the pure layout into the node-only rendition package, parameterized by `cacheRoot` (so it's env-free).

**Files:**
- Create: `packages/ingest/src/paths.ts`
- Modify: `packages/ingest/src/index.ts`
- Test: `packages/ingest/src/paths.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/ingest/src/paths.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { catalogCacheDirs, displayPath, editedDisplayPath, thumbnailPath } from "./paths.js";

describe("catalog cache paths", () => {
  const root = "/cache";

  it("catalogCacheDirs nests the three rendition dirs under <root>/<catalogId>", () => {
    expect(catalogCacheDirs(root, "cat1")).toEqual({
      thumbnailsDir: "/cache/cat1/thumbnails",
      displaysDir: "/cache/cat1/displays",
      editedDisplaysDir: "/cache/cat1/displays-edited",
    });
  });

  it("the file-path helpers point at <dir>/<id>.webp", () => {
    expect(thumbnailPath(root, "cat1", "p1")).toBe("/cache/cat1/thumbnails/p1.webp");
    expect(displayPath(root, "cat1", "p1")).toBe("/cache/cat1/displays/p1.webp");
    expect(editedDisplayPath(root, "cat1", "p1")).toBe("/cache/cat1/displays-edited/p1.webp");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @lumio/ingest test -- paths`
Expected: FAIL — `./paths.js` does not exist (import/resolve error).

- [ ] **Step 3: Create the builder module**

Create `packages/ingest/src/paths.ts`:
```ts
import path from "node:path";

/** The three per-catalog rendition cache directories, nested under a cache root.
 *  Structurally identical to RegenerateDeps (regenerate.ts) so it can be passed
 *  straight to regenerateRenditions. */
export interface CatalogCacheDirs {
  thumbnailsDir: string;
  displaysDir: string;
  editedDisplaysDir: string;
}

/** Per-catalog rendition cache directories under `cacheRoot`. Env-free — the caller
 *  supplies the resolved cache root — so this stays a pure layout helper and is the
 *  single source of the cache directory convention. */
export function catalogCacheDirs(cacheRoot: string, catalogId: string): CatalogCacheDirs {
  const base = path.join(cacheRoot, catalogId);
  return {
    thumbnailsDir: path.join(base, "thumbnails"),
    displaysDir: path.join(base, "displays"),
    editedDisplaysDir: path.join(base, "displays-edited"),
  };
}

/** Absolute path of a photo's thumbnail rendition. */
export function thumbnailPath(cacheRoot: string, catalogId: string, id: string): string {
  return path.join(catalogCacheDirs(cacheRoot, catalogId).thumbnailsDir, `${id}.webp`);
}

/** Absolute path of a photo's edit-free base display rendition. */
export function displayPath(cacheRoot: string, catalogId: string, id: string): string {
  return path.join(catalogCacheDirs(cacheRoot, catalogId).displaysDir, `${id}.webp`);
}

/** Absolute path of a photo's baked edited-display rendition. */
export function editedDisplayPath(cacheRoot: string, catalogId: string, id: string): string {
  return path.join(catalogCacheDirs(cacheRoot, catalogId).editedDisplaysDir, `${id}.webp`);
}
```

- [ ] **Step 4: Export from the ingest barrel**

In `packages/ingest/src/index.ts`, add (after the other `export *` lines):
```ts
export * from "./paths.js";
```

- [ ] **Step 5: Run the test + typecheck**

Run: `pnpm --filter @lumio/ingest test -- paths`
Expected: PASS.
Run: `pnpm --filter @lumio/ingest exec tsc --noEmit`
Expected: clean (no collision — ingest does not already export `catalogCacheDirs`/`thumbnailPath`/`displayPath`/`editedDisplayPath`/`CatalogCacheDirs`).

- [ ] **Step 6: Commit**

```bash
git add packages/ingest/src/paths.ts packages/ingest/src/index.ts packages/ingest/src/paths.test.ts
git commit -m "ingest: own the per-catalog rendition cache-path layout"
```

---

## Task 2: Point worker + web at the centralized builders

Replace the duplicated inline layout in `apps/worker/src/config.ts` and `apps/web/src/lib/paths.ts` with delegation to Task 1's builders, binding each app's own `CACHE_DIR`. Public function signatures are unchanged, so no consumer needs editing.

**Files:**
- Modify: `apps/worker/src/config.ts`
- Modify: `apps/web/src/lib/paths.ts`

- [ ] **Step 1: Refactor the worker config builders**

In `apps/worker/src/config.ts`, add the import (top, with the others):
```ts
import {
  catalogCacheDirs as catalogCacheDirsUnder,
  displayPath as displayPathUnder,
  editedDisplayPath as editedDisplayPathUnder,
  thumbnailPath as thumbnailPathUnder,
  type CatalogCacheDirs,
} from "@lumio/ingest";
```
Then DELETE the local `CatalogCacheDirs` interface and the four inline functions (`catalogCacheDirs`, `thumbnailPath`, `displayPath`, `editedDisplayPath` — the `path.join(CACHE_DIR, ...)` bodies) and replace them with thin delegations bound to `CACHE_DIR`:
```ts
export type { CatalogCacheDirs };

/** Per-catalog cache directory paths nested under the shared CACHE_DIR. */
export function catalogCacheDirs(catalogId: string): CatalogCacheDirs {
  return catalogCacheDirsUnder(CACHE_DIR, catalogId);
}

/** Absolute path of a photo's thumbnail file within a catalog's cache. */
export function thumbnailPath(catalogId: string, id: string): string {
  return thumbnailPathUnder(CACHE_DIR, catalogId, id);
}

/** Absolute path of a photo's display rendition within a catalog's cache. */
export function displayPath(catalogId: string, id: string): string {
  return displayPathUnder(CACHE_DIR, catalogId, id);
}

/** Absolute path of a photo's edited display rendition within a catalog's cache. */
export function editedDisplayPath(catalogId: string, id: string): string {
  return editedDisplayPathUnder(CACHE_DIR, catalogId, id);
}
```
Keep everything else in `config.ts` unchanged (`REPO_ROOT`, `resolveFromRoot`, `CACHE_DIR`, `TRASH_DIR`, `resolveConcurrency`, `INGEST_CONCURRENCY`, the `os`/`path` imports — `path` is still used by `resolveFromRoot`/`CACHE_DIR`).

- [ ] **Step 2: Refactor the web path builders**

In `apps/web/src/lib/paths.ts`, add the import (top):
```ts
import {
  catalogCacheDirs as catalogCacheDirsUnder,
  displayPath as displayPathUnder,
  editedDisplayPath as editedDisplayPathUnder,
  thumbnailPath as thumbnailPathUnder,
  type CatalogCacheDirs,
} from "@lumio/ingest";
```
Replace the three inline rendition builders (`thumbnailPath`, `displayPath`, `editedDisplayPath`) with delegations bound to `CACHE_DIR`, and ADD `catalogCacheDirs` (web didn't have it; Task 3 needs it). Keep `trashThumbnailPath`, `originalPath`, `isInsideMediaRoot`, `browseDir`, `MEDIA_ROOT`, `ROOT`, `CACHE_DIR`, `TRASH_DIR` exactly as they are:
```ts
export type { CatalogCacheDirs };

export function catalogCacheDirs(catalogId: string): CatalogCacheDirs {
  return catalogCacheDirsUnder(CACHE_DIR, catalogId);
}

export function thumbnailPath(catalogId: string, id: string): string {
  return thumbnailPathUnder(CACHE_DIR, catalogId, id);
}

export function displayPath(catalogId: string, id: string): string {
  return displayPathUnder(CACHE_DIR, catalogId, id);
}

export function editedDisplayPath(catalogId: string, id: string): string {
  return editedDisplayPathUnder(CACHE_DIR, catalogId, id);
}
```

- [ ] **Step 3: Verify the whole workspace is green**

The builders' outputs are unchanged (same layout, now sourced from Task 1), and Task 1's test already proves the layout. The consumers are exercised by the existing suite. Run:
`pnpm -r test`
Expected: all packages green (notably worker `scan` tests + the full web suite). If anything fails, the binding diverged from the old output — fix before committing.
Then `pnpm --filter @lumio/worker exec tsc --noEmit` and `pnpm --filter @lumio/web exec tsc --noEmit` → no NEW errors (a pre-existing `calendar.ts` error in `@lumio/shared` is unrelated and out of scope).

- [ ] **Step 4: Commit**

```bash
git add apps/worker/src/config.ts apps/web/src/lib/paths.ts
git commit -m "worker+web: source the rendition cache layout from @lumio/ingest"
```

---

## Task 3: Unify the save path — `applyPhotoEdits` delegates to `regenerateRenditions`

Spec §7. Delete `applyPhotoEdits`'s bespoke decode → build → write-files logic and call `@lumio/ingest`'s `regenerateRenditions` (the single rendition writer), keeping only the catalog-scoped lookup and the DB update. See the **Behavior note** at the top about the now-rewritten base display.

**Files:**
- Modify: `apps/web/src/lib/photo-edits-service.ts`
- Test: `apps/web/src/lib/photo-edits-service.test.ts`

- [ ] **Step 1: Update the test mocks and add the delegation tests (TDD)**

Rewrite the mock block at the top of `apps/web/src/lib/photo-edits-service.test.ts`. REMOVE the `node:fs/promises` mock and the old `@lumio/ingest` (`buildRenditions`/`decodeToSharpInput`) + `@/lib/paths` (`thumbnailPath`/`editedDisplayPath`) mocks; replace with:
```ts
vi.mock("@lumio/ingest", () => ({
  regenerateRenditions: vi.fn(async () => ({ thumbhash: "hash", width: 100, height: 100 })),
}));

vi.mock("@/lib/paths", () => ({
  catalogCacheDirs: vi.fn((catalogId: string) => ({
    thumbnailsDir: `/cache/${catalogId}/thumbnails`,
    displaysDir: `/cache/${catalogId}/displays`,
    editedDisplaysDir: `/cache/${catalogId}/displays-edited`,
  })),
  originalPath: vi.fn((catalog: { path: string }, relPath: string) => `${catalog.path}/${relPath}`),
}));
```
Keep the two existing tests ("returns null for a foreign id", "scopes the findFirst query"). Append two new tests inside the `describe("applyPhotoEdits", ...)` block:
```ts
it("delegates renditions to @lumio/ingest and persists the returned dims/thumbhash", async () => {
  const { regenerateRenditions } = await import("@lumio/ingest");
  const photoRow = makePhotoRow();
  const findFirst = vi.fn().mockResolvedValue(photoRow);
  const update = vi.fn().mockResolvedValue({ ...photoRow, width: 100, height: 100, thumbhash: "hash" });
  const db = { photo: { findFirst, update } };
  const recipe = { rotate: 90 as const, flipH: false, flipV: false };

  await applyPhotoEdits(CAT_OBJ, PHOTO_ID, recipe, db as never);

  expect(regenerateRenditions).toHaveBeenCalledWith(
    `${CAT_OBJ.path}/2024/photo.jpg`,
    recipe,
    PHOTO_ID,
    {
      thumbnailsDir: `/cache/${CAT_OBJ.id}/thumbnails`,
      displaysDir: `/cache/${CAT_OBJ.id}/displays`,
      editedDisplaysDir: `/cache/${CAT_OBJ.id}/displays-edited`,
    },
  );
  expect(update).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { id: PHOTO_ID, catalogId: CAT_OBJ.id },
      data: expect.objectContaining({ width: 100, height: 100, thumbhash: "hash" }),
    }),
  );
});

it("reset (null edits) passes a null recipe and clears edits with Prisma.JsonNull", async () => {
  const { regenerateRenditions } = await import("@lumio/ingest");
  const { Prisma } = await import("@lumio/db");
  const photoRow = makePhotoRow({ edits: { rotate: 90, flipH: false, flipV: false } });
  const findFirst = vi.fn().mockResolvedValue(photoRow);
  const update = vi.fn().mockResolvedValue(photoRow);
  const db = { photo: { findFirst, update } };

  await applyPhotoEdits(CAT_OBJ, PHOTO_ID, null, db as never);

  expect(regenerateRenditions).toHaveBeenCalledWith(expect.any(String), null, PHOTO_ID, expect.any(Object));
  expect(update).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ edits: Prisma.JsonNull }) }),
  );
});
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `pnpm --filter @lumio/web test -- photo-edits-service`
Expected: the two new tests FAIL (current `applyPhotoEdits` calls `buildRenditions`/`decodeToSharpInput`/`writeFile`, not `regenerateRenditions`, so the `regenerateRenditions` spy is never called). The two original tests may also error now that their old mocks were removed — that's expected; they pass after Step 3.

- [ ] **Step 3: Refactor `applyPhotoEdits`**

Replace the entire body of `apps/web/src/lib/photo-edits-service.ts` with:
```ts
import { Prisma, type PrismaClient, prisma, toPhotoDTO } from "@lumio/db";
import { hasEdits, type PhotoDTO, type PhotoEdits } from "@lumio/shared";
import { regenerateRenditions } from "@lumio/ingest";
import { catalogCacheDirs, originalPath } from "@/lib/paths";

type Db = Pick<PrismaClient, "photo">;

/**
 * Apply a photo's edit recipe and persist it. Passing `null` (or the identity
 * recipe) resets the photo to its original. Returns the updated DTO, or null if the
 * photo doesn't exist in the given catalog.
 *
 * `@lumio/ingest`'s regenerateRenditions is the single owner of rendition writes —
 * it (re)writes the edit-free base display, the thumbnail, and the baked edited
 * display (removing the edited variant on reset) and returns the stored
 * dims/thumbhash. Renditions are written before the DB update: if the update fails,
 * the on-disk files are ahead of Photo.edits/updatedAt, so the unchanged cache-bust
 * token keeps clients on the old URL until a later successful apply — rare,
 * self-heals on retry.
 *
 * `catalog` must carry `id` (DB scoping + cache paths) and `path` (the catalog root
 * on disk, for resolving the original via originalPath).
 */
export async function applyPhotoEdits(
  catalog: { id: string; path: string },
  id: string,
  edits: PhotoEdits | null,
  db: Db = prisma,
): Promise<PhotoDTO | null> {
  const photo = await db.photo.findFirst({ where: { id, catalogId: catalog.id } });
  if (!photo) return null;

  const recipe = hasEdits(edits) ? edits : null;
  const { thumbhash, width, height } = await regenerateRenditions(
    originalPath(catalog, photo.path),
    recipe,
    id,
    catalogCacheDirs(catalog.id),
  );

  const updated = await db.photo.update({
    where: { id, catalogId: catalog.id },
    // Prisma needs the JsonNull sentinel (not JS null) to clear a Json column.
    data: {
      edits: recipe ? (recipe as unknown as Prisma.InputJsonValue) : Prisma.JsonNull,
      width,
      height,
      thumbhash,
    },
  });
  return toPhotoDTO(updated);
}
```
This removes the `node:fs/promises`, `node:path`, `buildRenditions`/`decodeToSharpInput`, and `thumbnailPath`/`editedDisplayPath` imports/usage; the decode + file writes now live entirely in `regenerateRenditions`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @lumio/web test -- photo-edits-service`
Expected: all four tests PASS (the two originals + the two new delegation/reset tests).

- [ ] **Step 5: Run the whole workspace + typecheck**

Run: `pnpm -r test`
Expected: every package green (the ingest `regenerate` tests are untouched and still pass; nothing else consumes `applyPhotoEdits`' internals).
Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: no new errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/photo-edits-service.ts apps/web/src/lib/photo-edits-service.test.ts
git commit -m "web: applyPhotoEdits delegates rendition writes to @lumio/ingest"
```

---

## Final verification (after all three tasks)

- [ ] `pnpm -r test` → all packages green (workspace gate — A1's lesson; do not rely on a single `--filter`).
- [ ] Confirm the duplication is gone: `grep -rn "displays-edited" apps packages --include=*.ts | grep -v test` should now show the literal only in `packages/ingest/src/paths.ts` (the single source) — not in `worker/config.ts` or `web/lib/paths.ts`.
- [ ] Confirm `applyPhotoEdits` no longer imports `node:fs/promises`, `buildRenditions`, or `decodeToSharpInput`.

---

## Remaining Phase A increments (planned just-in-time)

Specified in `docs/superpowers/specs/2026-06-23-photo-editor-refactor-design.md`:
- **A3 — Folder restructure + component split (spec §4, §6):** `features/{photo-grid,lightbox,photo-editor}/` + barrels; extract `colorCssFilter`/`colorOverlays` → `photo-editor/render/css-preview.ts` and point `edited-result.tsx` at A1's `effectiveCrop`/`outputSize` (**carry-forward:** `zoomable-image.tsx:397` falls back to `null` not full-frame — use `working.crop ? effectiveCrop(...) : null` there); split `ZoomableImage` (`use-display-buffer`/`use-hi-res-swap`/`use-measured-size`/`crop-editor-canvas`/`preview-stage`); split `useEditSession` into state vs actions contexts.
- **A4 — Correctness fixes (spec §8):** `lightbox-sidebar` `resync` cancellation guard; `mappers.ts` Zod validation of `exif`/`rules`.
- **Phase B follow-up surfaced here:** add a `server-only` guard to `apps/web/src/lib/paths.ts` (A2 makes it pull in `@lumio/ingest`/sharp transitively; all current importers are server routes, so it's safe today, but the guard belongs with the Phase B `lib/` split).

## Self-review

- **Spec coverage (A2 slice):** §7 save-path unification → Task 3 ✓; §7 rendition path centralization → Tasks 1+2 ✓ (in ingest, deviation documented). 
- **Placeholder scan:** none — every step has concrete code/commands.
- **Type consistency:** `CatalogCacheDirs { thumbnailsDir; displaysDir; editedDisplaysDir }` is defined once (Task 1), re-exported by worker/web (Task 2), and is structurally the `RegenerateDeps` that `regenerateRenditions` accepts (Task 3 passes `catalogCacheDirs(catalog.id)` straight in). `catalogCacheDirs` has two arities by design: `(cacheRoot, catalogId)` in ingest (Task 1) vs the bound `(catalogId)` re-exported by worker/web (Task 2) — intentional, and the web test mocks the bound 1-arg form. `regenerateRenditions(absPath, edits, id, deps)` signature matches Task 3's call.
