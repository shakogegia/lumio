# Multi-Catalog — Phase 2: API Layer — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Nest every catalog-scoped API route under `/api/c/[catalog]/…`, scope every Photo/Album/Folder/Trash query by `catalogId`, and add the global routes (catalog CRUD, folder browser, profile). After this phase, `apps/web` type-checks again and the server layer is fully catalog-aware. Client-side URL building + page routing are Phase 3.

**Architecture:** A `withCatalog` wrapper resolves the `[catalog]` slug → catalog row (404 if missing), composing the existing `withAuth`. The thin route handlers pass `catalog.id` into the **service layer** (`apps/web/src/lib/*-service.ts`), which is where the Prisma queries live — each service function gains a `catalogId` parameter and scopes its `where`/`create`. Per-photo asset routes resolve the catalog from the segment and verify `photo.catalogId === catalog.id` (404 on mismatch). Web `paths.ts` becomes catalog-aware (`MEDIA_ROOT`, per-catalog cache/trash, `originalPath(catalog, rel)`, `browseDir`).

**Tech Stack:** Next.js 16 App Router (route handlers), Prisma, Vitest, zod.

**Scope boundary / expected state:** Client components/pages still call the OLD URLs (`/api/photos`, …) and `rendition-url.ts` is unchanged — so the app does NOT run end-to-end yet (it was already non-functional after Phase 1). Phase 2's verification target is: `apps/web` **type-checks clean** (only the pre-existing `calendar.ts` errors remain) and all service-layer unit tests pass. Page routing, the catalog switcher, client fetch/URL updates, and `AppSettings` retirement are Phase 3.

**Prerequisite note:** The destructive migration (`20260622120000_multi_catalog`) is authored but NOT applied to the shared dev DB (it's drifted with another branch's data). Phase 2 is unit-tested with fake DBs, so it does not require the live migration. The generated Prisma client already has the catalog models.

---

## File Structure

**Created:**
- `apps/web/src/lib/with-catalog.ts` (+ `.test.ts`) — resolve `[catalog]` slug → catalog, 404, compose `withAuth`.
- `apps/web/src/lib/fs-browse.ts` (+ `.test.ts`) — `browseDir(absPath)` bounded to `MEDIA_ROOT` (move/extend from paths.ts if cleaner).
- `apps/web/src/lib/catalog-service.ts` (+ `.test.ts`) — list/create/rename/delete orchestration (validates path under MEDIA_ROOT, no dup/nested, calls `@lumio/db` catalog CRUD, enqueues scan/cleanup jobs).
- `apps/web/src/lib/profile-service.ts` (+ `.test.ts`) — read/update per-user settings via `@lumio/db` `getUserSettings`/`updateUserSettings`.
- Global routes: `apps/web/src/app/api/catalogs/route.ts` (GET/POST), `apps/web/src/app/api/catalogs/[id]/route.ts` (PATCH/DELETE), `apps/web/src/app/api/fs/browse/route.ts` (GET), `apps/web/src/app/api/profile/route.ts` (GET/PUT).
- Catalog-scoped routes under `apps/web/src/app/api/c/[catalog]/…` (moved from their current locations — see Task 7 table).

**Modified:**
- `apps/web/src/lib/paths.ts` — `MEDIA_ROOT`; per-catalog `thumbnailPath(catalogId,id)`/`displayPath`/`editedDisplayPath`/`trashThumbnailPath(catalogId,id)`; `originalPath(catalog, rel)`; `browseDir`.
- `apps/web/src/lib/status-service.ts` — per-catalog stats (`getCatalogStats(catalogId)`, `getStorageSizes(catalog)`, `getPhotoFileCount(catalog)`).
- The service layer: `photos-service.ts`, `albums-service.ts`, `folders-service.ts`, `search-service.ts`, `trash-service.ts`, `calendar-service.ts`, `download-service.ts`, `photo-edits-service.ts`, `upload-service.ts` — each gains `catalogId` and scopes queries (+ their `.test.ts`).
- `@lumio/db` where-builders are AND-combined with `{ catalogId }` at the call sites (no change to the pure builders).

**Deleted:** the old route files once moved (Task 7).

---

## Canonical transforms (apply throughout)

**A. Route under `c/[catalog]` using `withCatalog`:**
```ts
// apps/web/src/app/api/c/[catalog]/photos/route.ts
import { withCatalog } from "@/lib/with-catalog";
import { listPhotos } from "@/lib/photos-service";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = withCatalog(async (request, ctx, { catalog }) => {
  const { searchParams } = new URL(request.url);
  const page = await listPhotos(catalog.id, { /* parsed params */ });
  return Response.json(page);
});
```

**B. Service function gains `catalogId` + scopes the query:**
```ts
// before: prisma.photo.findMany({ where: { ...filters }, ... })
// after:  prisma.photo.findMany({ where: { catalogId, ...filters }, ... })
export async function listPhotos(catalogId: string, params: …) { … where: { catalogId, … } … }
```
For where-builders that return a `PhotoWhereInput` (e.g. `buildSearchWhere`, `smartAlbumWhere`, `folderPhotoWhere`): combine as `{ catalogId, ...built }` (Prisma ANDs top-level keys; a top-level `OR` inside `built` stays ANDed with `catalogId`).

**C. Per-photo asset route (resolve catalog from segment, guard cross-catalog):**
```ts
export const GET = withCatalog(async (request, ctx, { catalog }) => {
  const { id } = await ctx.params; // [catalog] + [id] both in params
  const photo = await prisma.photo.findUnique({ where: { id }, select: { id: true, catalogId: true, updatedAt: true } });
  if (!photo || photo.catalogId !== catalog.id) return new Response("Not found", { status: 404 });
  // serve cache/<catalog.id>/… via displayPath(catalog.id, id) etc.
});
```

---

## Task 1: Web paths catalog-aware + `browseDir`

**Files:** modify `apps/web/src/lib/paths.ts`; create `apps/web/src/lib/paths.test.ts` (if absent) for the boundary logic.

- [ ] **Step 1 (TDD): write `paths.test.ts`** covering `browseDir` boundary + per-catalog cache path:
```ts
import { describe, expect, it } from "vitest";
import { catalogCachePaths, isInsideMediaRoot } from "./paths.js";
describe("media-root boundary", () => {
  it("accepts paths under MEDIA_ROOT and rejects traversal", () => {
    // with MEDIA_ROOT=/media:
    expect(isInsideMediaRoot("/media/family")).toBe(true);
    expect(isInsideMediaRoot("/media")).toBe(true);
    expect(isInsideMediaRoot("/media/../etc")).toBe(false);
    expect(isInsideMediaRoot("/etc/passwd")).toBe(false);
  });
});
```
(Set `process.env.MEDIA_ROOT` in the test or assert relative to the default; match how the codebase tests env-derived constants — see existing tests. If env-at-import-time makes this awkward, export a pure `isInside(root, candidate)` and test that.)

- [ ] **Step 2: implement in `paths.ts`:**
  - `export const MEDIA_ROOT = path.resolve(process.env.MEDIA_ROOT ?? "/media");`
  - Keep `CACHE_DIR`/`TRASH_DIR`. Make helpers catalog-aware: `thumbnailPath(catalogId, id)` → `CACHE_DIR/<catalogId>/thumbnails/<id>.webp`; same for `displayPath`/`editedDisplayPath`; `trashThumbnailPath(catalogId, id)` → `TRASH_DIR/<catalogId>/thumbnails/<id>.webp`.
  - `originalPath(catalog: { path: string }, relPath: string)` resolves under `catalog.path` with the existing traversal guard (resolved must stay within `catalog.path`).
  - `browseDir(absPath: string)`: resolve, reject if not inside `MEDIA_ROOT` (`isInsideMediaRoot`), else `readdir` returning only directories. Provide the pure `isInsideMediaRoot(p)` used by the test.

- [ ] **Step 3:** run `pnpm --filter @lumio/web exec vitest run src/lib/paths.test.ts` → PASS. (Other web files may not compile yet — fine.) Commit: `web: catalog-aware paths + MEDIA_ROOT browse boundary`.

---

## Task 2: `withCatalog` wrapper

**Files:** create `apps/web/src/lib/with-catalog.ts` + `apps/web/src/lib/with-catalog.test.ts`. Read `apps/web/src/lib/with-auth.ts` first (compose it, don't reinvent the session check).

- [ ] **Step 1 (TDD): test** — given a request whose `params.catalog` slug exists, the handler is called with the resolved catalog; an unknown slug → 404; (auth is delegated to `withAuth`, assume session present in the test by mocking it the same way `with-auth.test.ts` does).
```ts
// pseudocode shape; mirror with-auth.test.ts's mocking
it("resolves the slug and passes the catalog", async () => { /* getCatalogBySlug → {id:'c1',slug:'fam'} ; handler receives catalog */ });
it("404s on unknown slug", async () => { /* getCatalogBySlug → null ; expect 404 */ });
```

- [ ] **Step 2: implement** `withCatalog(handler)` that returns a route handler: run the `withAuth` session gate; read `ctx.params.catalog`; `const catalog = await getCatalogBySlug(slug)`; if none → `new Response("Catalog not found", { status: 404 })`; else call `handler(request, ctx, { session, catalog })`. Type `ctx.params` as `Promise<{ catalog: string } & Record<string,string>>` (Next 16 async params). Export a `CatalogRouteContext` type for handlers.

- [ ] **Step 3:** run the test → PASS. Commit: `web: withCatalog route wrapper (slug → catalog, 404)`.

---

## Task 3: Catalog + profile services & global routes

**Files:** create `catalog-service.ts`(+test), `profile-service.ts`(+test); routes `api/catalogs/route.ts`, `api/catalogs/[id]/route.ts`, `api/fs/browse/route.ts`, `api/profile/route.ts`.

- [ ] **Step 1 (TDD): `catalog-service.ts`** — `listCatalogsWithStats()` (or just `listCatalogs` passthrough for now), `createCatalog(input)` validating: `createCatalogSchema` (name/path), path is absolute + `isInsideMediaRoot`, not equal to and not nested within an existing catalog path (reuse `catalogForPath`-style check or a simple prefix test), then `@lumio/db` `createCatalog`, then enqueue a `rescan` job with the new `catalogId` (use the jobs queue helper — check `@lumio/jobs` `enqueueJob`/queue API). `renameCatalog(id, name)` → db `renameCatalog`. `deleteCatalog(id, mode: "detach" | "delete-originals")` → db `deleteCatalog` (cascade removes rows) and enqueue/perform cache+trash dir removal; for `delete-originals`, also remove the originals (enqueue a worker job or do it server-side — prefer a job with a `mode` flag; if the Job model can't carry mode, document the limitation and do detach-only cleanup here, leaving delete-originals for a worker job in a follow-up). Test the validation branches with a fake db (dup/nested path rejected; valid path accepted; slug derived).
- [ ] **Step 2: `profile-service.ts`** — `getProfile(userId)` → `getUserSettings`; `updateProfile(userId, input)` → `updateUserSettings`. Thin; test passthrough with fake db.
- [ ] **Step 3: routes** (all `withAuth`, NOT `withCatalog` — these are global):
  - `api/catalogs/route.ts`: `GET` → `listCatalogs()`; `POST` → parse `createCatalogSchema`, `createCatalog`, 201 with the row (400 on validation error).
  - `api/catalogs/[id]/route.ts`: `PATCH` → rename; `DELETE` → read `?mode=` (default `detach`), `deleteCatalog`.
  - `api/fs/browse/route.ts`: `GET` → `?path=` (default `MEDIA_ROOT`), return `{ path, parent, dirs: [{name, path}] }` via `browseDir`; 400 if outside `MEDIA_ROOT`.
  - `api/profile/route.ts`: `GET` → `getProfile(session.user.id)`; `PUT` → `updateProfile`.
- [ ] **Step 4:** run the service tests → PASS. Commit: `web: catalog/profile services + global routes (catalogs, fs/browse, profile)`.

---

## Task 4: Scope photos / calendar / download / edits services

**Files:** modify `photos-service.ts`, `calendar-service.ts`, `download-service.ts`, `photo-edits-service.ts` (+ their tests). Read each first.

- [ ] **Step 1 (TDD):** update each service's tests so every query is asserted to include `catalogId` (extend existing fake-db assertions). Add `catalogId` as the **first parameter** of every exported function that issues a Photo query (e.g. `listPhotos(catalogId, params)`, `getPhoto(catalogId, id)`, `setColorLabel(catalogId, ids, label)`, `setFavorite(catalogId, ids, fav)`, `getPhotoCalendar(catalogId, …)`, `downloadPhotos(catalogId, ids)`, `applyEdit(catalogId, id, edits)`).
- [ ] **Step 2:** implement the scoping per transform B. For batch ops (`updateMany`/`findMany` by id list), use `where: { catalogId, id: { in: ids } }` (so a caller can't touch another catalog's photos). For single-photo by id, fetch with `where: { id }` then verify `catalogId` matches (or query `findFirst({ where: { id, catalogId } })`). Cache paths now use `thumbnailPath(catalogId, id)` etc.
- [ ] **Step 3:** run the four services' tests → PASS. Commit: `web: scope photos/calendar/download/edits services by catalogId`.

---

## Task 5: Scope albums / folders services

**Files:** modify `albums-service.ts`, `folders-service.ts` (+ tests). Read first.

- [ ] **Step 1 (TDD):** add `catalogId` to: album create (sets `catalogId` on the new Album), list/get (scope by `catalogId`), album photo membership queries (the photo set must be scoped: `{ catalogId, ...folderPhotoWhere(...) }` / `{ catalogId, ...smartAlbumWhere(...) }`), folder CRUD (folders carry `catalogId`), `library/tree` data. Assert scoping in tests.
- [ ] **Step 2:** implement. Album `create` data includes `catalogId`; `findMany`/`findUnique` scope by it; smart-album + folder photo resolution AND-combined with `catalogId`. Folder create sets `catalogId`; folder tree queries scope by it.
- [ ] **Step 3:** tests → PASS. Commit: `web: scope albums/folders services by catalogId`.

---

## Task 6: Scope search / trash / upload services

**Files:** modify `search-service.ts`, `trash-service.ts`, `upload-service.ts` (+ tests). Read first.

- [ ] **Step 1 (TDD):** `searchPhotos(catalogId, …)` and `countSearchPhotos(catalogId, …)` → `{ catalogId, ...buildSearchWhere(...) }`. `trash-service`: list/restore/purge scoped by `catalogId` (TrashedPhoto carries `catalogId`); restore re-creates a Photo with `catalogId`; the per-catalog `trashDir` = `TRASH_DIR/<catalogId>`. `upload-service`: thread `catalogId` (and the catalog's `path` + `uploadTemplate`) — `findPhotoByHash(catalogId, hash, db)` and `ingestPath`/`placeUpload` use the catalog root + the catalog's `uploadTemplate` (from the Catalog row, not `AppSettings`). Update tests to assert scoping.
- [ ] **Step 2:** implement. **This resolves the Phase 1 deferred `upload-service.ts` breakage** (findPhotoByHash/ingestPath signatures). Read `uploadTemplate` from the catalog row.
- [ ] **Step 3:** tests → PASS. Commit: `web: scope search/trash/upload services by catalogId`.

---

## Task 7: Move catalog-scoped routes under `api/c/[catalog]/`

**Files:** move each route below from `apps/web/src/app/api/<X>` to `apps/web/src/app/api/c/[catalog]/<X>`, wrap each in `withCatalog`, and pass `catalog.id` (+ `catalog` where the originals/uploads path is needed) into the now-scoped service. Delete the old files. (`auth/[...all]` stays put; `catalogs`, `fs`, `profile` from Task 3 stay global.)

| Move from `api/…` | to `api/c/[catalog]/…` | notes |
|---|---|---|
| `photos/route.ts` | `photos/route.ts` | `listPhotos(catalog.id, …)` |
| `photos/[id]/route.ts` | `photos/[id]/route.ts` | cross-catalog 404 guard |
| `photos/[id]/display`,`/original`,`/edited` | same | asset routes — guard + `displayPath(catalog.id,id)` etc. |
| `photos/[id]/edit` | same | `applyEdit(catalog.id,id,…)` |
| `photos/calendar` | same | `getPhotoCalendar(catalog.id,…)` |
| `photos/color-label`,`/favorite`,`/download`,`/locate`,`/trash`,`/purge` | same | batch ops scoped |
| `thumbnails/[id]` | `photos/[id]/thumbnail` | RENAME to nest under photos; guard + `thumbnailPath(catalog.id,id)` |
| `albums/route.ts`,`albums/[id]/*` | same | scoped album services |
| `folders/route.ts`,`folders/[id]/*`,`folders/move` | same | scoped folder services |
| `search/route.ts`,`search/calendar` | same | scoped search |
| `trash/route.ts`,`trash/restore`,`trash/purge`,`trash/empty` | same | scoped trash + job catalogId |
| `settings/route.ts` | same | now writes `Catalog.uploadTemplate` (PUT), not AppSettings |
| `rescan/route.ts` | same | enqueue rescan job with `catalog.id` |
| `storage/refresh` | same | per-catalog stat invalidation |
| `library/tree` | same | scoped |
| `activity` | same | (worker status is global, but keep the route under catalog for client simplicity; it may ignore the catalog) |
| `uploads/route.ts` | same | `handleUpload(catalog, …)` |

- [ ] **Step 1:** move + rewire each route per transform A / the asset-route guard. For `rescan`/`trash/empty`/`purge` routes, create the `Job` with `catalogId: catalog.id` (check the jobs queue API for the create call).
- [ ] **Step 2:** delete the old route files. Confirm no route remains directly under `api/photos`, `api/albums`, etc. (except the global ones).
- [ ] **Step 3:** commit: `web: nest all catalog-scoped routes under /api/c/[catalog]`.

---

## Task 8: apps/web typecheck green-check

**Files:** none (verification + any small fixups).

- [ ] **Step 1:** `pnpm --filter @lumio/web typecheck 2>&1 | grep 'error TS' | grep -v calendar.ts` → must be EMPTY. Fix any stragglers (most likely: a route still calling an unscoped service signature, or a client component importing a moved server util — note client/page fetch URLs are strings and won't show as TS errors; those are Phase 3).
- [ ] **Step 2:** run the full web unit suite: `pnpm --filter @lumio/web test` → all PASS.
- [ ] **Step 3:** run the whole repo test suite `pnpm -r test` (backend + web) → green except known `calendar.ts` typecheck (tests pass). Commit any fixups: `web: phase 2 typecheck green`.

---

## Self-Review notes
- **Spec coverage:** `/api/c/[catalog]/…` nesting (Task 7) ✓; catalog scoping in services (Tasks 4–6) ✓; asset cross-catalog guard (transform C) ✓; global catalogs CRUD + fs/browse + profile (Task 3) ✓; MEDIA_ROOT-bounded browser (Task 1) ✓; upload uses per-catalog `uploadTemplate` (Task 6) ✓. Deferred to Phase 3: page routing under `/c/[catalog]`, client URL/`rendition-url` updates, switcher, `AppSettings` retirement, settings-page reorg.
- **Open question for execution:** `deleteCatalog(mode: "delete-originals")` — if the `Job` model can't carry a `mode`, do detach-cleanup in the service and file a worker job for originals; confirm the jobs queue `create` API during Task 3.
- **Known intentional non-runnable state:** client still calls old URLs until Phase 3.
