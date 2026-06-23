# Refactor Phase B/C — Route + lib hygiene + polish — design

**Date:** 2026-06-23
**Status:** Approved for planning
**Scope:** The remaining code-quality cleanup from the audit (`.context/code-quality-audit.md`), beyond the Phase A editor work (PR #78). Two phases on the same branch/PR: **Phase B** (API route hygiene + the flat `lib/` restructure) and **Phase C** (lint-enforceable polish + documenting the single-tenant stance). Seven behavior-preserving increments, each its own plan + subagent-driven execution + two-stage review + `pnpm -r test` gate (the A1/A2/A3 discipline). NOT building pixi.js — this is the standalone quality work, valuable on its own.
**Out of scope:** the pixi.js rebuild; feature-first co-location of services (deferred — see Decision 1); further internal `ZoomableImage` slimming (superseded by the pixi rewrite); **building multi-tenancy** (deferred to the future multi-user feature — see Decision 2).

## 1. Decisions (from brainstorming)

1. **`lib/` restructure: layered split (option a).** Organize the flat 119-file `lib/` by technical role — `lib/server/` (DB-touching services, with `server-only` guards), `lib/hooks/` (client `use-*`), `components/providers/` (the one provider), and `lib/` keeps only pure framework-agnostic utils. NOT feature-first co-location (that's a separate, bigger architectural project, better done feature-by-feature as areas are actively worked).
2. **Catalog ownership: document single-tenant (option b).** Lumio is single-admin *by design* today (first-run setup creates one admin, then `assertSignupAllowed` hard-closes signup; multi-user/invites is roadmap-deferred). Do NOT build `Catalog.userId`/scoping now — it's speculative work for users who don't exist, and a half-built tenancy model is a security trap. Document the intentional single-tenant stance; add the ownership model *as part of* the multi-user feature when it ships.
3. **Behavior-preserving.** Every increment preserves user-observable behavior. The only "behavior" change anywhere is standardizing API error *response shapes* (B1), which is an internal contract tidy, not a UX change. C2 is docs-only.

## 2. Current-state grounding (verified 2026-06-23)

- `apps/web/src/lib/` = **119 files**: 16 import `@lumio/db` (services), 10 are `use-*` hooks, 1 is a provider (`catalog-context.tsx`), the rest pure-ish utils.
- `apps/web/src/app/api/` = **44 `route.ts`**: **12** import `prisma` directly; **19** carry the `safeParse` + `parsed.error.flatten()` boilerplate; **17** call `request.json()` with no `.catch()` → throw → unhandled 500 (no `app/api/error.ts` exists).
- `profile/route.ts` writes to the DB with **no validation**. Three FS routes (`fs/browse`, `fs/calendar`, `fs/photos`) return plain-text errors vs `{ error }` JSON elsewhere.
- Path-layout leftovers (post-A2): `uploads/route.ts:32-33` inlines a 2-field cache-dir subset; `packages/jobs/src/purge.ts` + the trash routes still inline subdir literals.
- Typed domain errors already exist (`AlbumNotFoundError`, `SmartAlbumMutationError`, `FolderNotFoundError`, `FolderCycleError`, `FeatureScopeError`) — mapped ad-hoc per route today.

---

## Phase B — Route + lib hygiene

### B1 · API route helpers (highest leverage)
**Problem:** 19× copy-pasted parse-and-400 blocks; 17 routes 500 on malformed JSON; inconsistent error shapes; `profile` unvalidated.
**Design:** three small helpers (introduce `lib/server/` here — it's where they'll live after B5):
- `errorJson(message: string, status: number, details?: unknown): NextResponse` — the single response shape `{ error: string; details?: unknown }`.
- `parseJson<T>(request, schema: ZodSchema<T>): Promise<{ data: T } | { response: NextResponse }>` — `await request.json().catch(() => null)` then `safeParse`; on failure returns `{ response: errorJson("Invalid request body", 400, parsed.error.flatten()) }`. Routes do `const r = await parseJson(req, S); if ("response" in r) return r.response;`.
- `parseQuery<T>(request, schema): { data } | { response }` — same for `searchParams` (`Object.fromEntries`; the repeated `album: getAll("album")` search case gets a dedicated `parseSearchQuery`).
- `mapServiceError(err: unknown): NextResponse | null` — maps the known typed domain errors to status codes, returns `null` to signal rethrow. Routes wrap their service call in `try { … } catch (e) { return mapServiceError(e) ?? (() => { throw e })(); }` (or a thin `withRouteErrors` wrapper).
**Also:** add the missing Zod schemas to `@lumio/shared` (`updateProfileSchema`, `featureToggleSchema`, catalog create/rename/reorder, `uploadTemplate`); wire them via `parseJson`. Convert the 3 plain-text FS routes to `errorJson`.
**Caveat:** the current validation responses return `{ error: parsed.error.flatten() }` (an object); standardizing to `{ error: string, details?: flatten }` is a shape change — the plan must first grep client consumers of `res.json().error` and confirm none parse the flatten object (the audit indicates they just `toast` a generic message); preserve detail for any that do.
**Tests:** unit-test `parseJson`/`parseQuery`/`mapServiceError`/`errorJson` (malformed JSON → 400 not throw; schema fail → shaped 400; known error → mapped status; unknown → rethrow). Existing route behavior unchanged (same success paths, same status codes).

### B2 · No Prisma in routes
**Problem:** 12 routes import `prisma` directly, re-hand-writing catalog-scoping `where` clauses (the one thing standing between catalogs) and bypassing the service layer.
**Design:** add the thin missing data-layer/service fns so every route calls a service/db function instead of `prisma`:
- `@lumio/db: setUploadTemplate(catalogId, template)` → replace the raw `prisma.catalog.update` in `settings/route.ts`.
- `photos-service: photoExistsInCatalog(catalogId, id)` and a `getPhotoForFile` → the image-serving routes (`thumbnail`/`display`/`original`/`edited`) use a shared `requirePhotoOwned(catalogId, id)` guard + a `binaryResponse(buffer, { contentType, cacheControl, download? })` helper (the `webp()` builder is currently copy-pasted in thumbnail+display).
- Job-enqueue routes (`rescan`/`purge`/`trash/empty`) route through service/db fns.
**Invariant:** zero `prisma` token under `app/api/`. Add an eslint `no-restricted-imports` rule for `@lumio/db`'s `prisma` under `app/api/**` to keep it enforced.
**Tests:** the new db/service fns get unit tests; routes verified by the existing suite + the lint rule.

### B3 · Service & path dedup
- `paginatePhotos(db, where, { limit, offset, sort }) → { items: rows.map(toPhotoDTO), total }` — collapse the 5+ near-identical `findMany + count → {items,total}` blocks (`listPhotos`, `searchPhotos`, `listAlbumPhotos`, `listFolderPhotos`); `listPhotosForWhere` is already this generalization.
- Finish the cache/trash path dedup onto A2's builders: `uploads/route.ts:32-33` → `catalogCacheDirs(catalog.id)`; add a `catalogTrashDirs(catalog)` (mirror of `catalogCacheDirs` for `TRASH_DIR`) and route the 3 trash routes + `jobs/purge.ts` through it.
**Tests:** `paginatePhotos` + `catalogTrashDirs` unit-tested; existing list/trash tests stay green.

### B4 · Straggler reuse (component-level dedup)
- `search-view.tsx`: replace the inline ~50-line favorite/label/add/download/trash cluster with `<SelectionActions actions={…} selectedIds={…} gridRef={…} clearSelection={…} />` (the shared component `PhotoLibraryView` already uses).
- `trash-view.tsx`: simplify the over-parameterized 6-arg `act()` into two explicit handlers.
- `upload-client.tsx`: reuse `useGridSelectionNav` for the shift-click selection (near drop-in; deletes the bespoke anchor ref + effect + `computeSelection`).
**Tests:** behavior-preserving; existing suite + tsc. (No new logic.)

### B5 · The `lib/` layered split (wide, mechanical — last)
Move, tsc-driven like the A3 relocation:
- `lib/server/` — the 16 DB services + `active-catalog`, `server-session`, `photo-detail-loader`, `detail-scope`, plus B1's `route-helpers` and B2's new fns. **Add `import "server-only"` to each** (or a single server barrel) so a client import fails at build time.
- `lib/hooks/` — the 10 `use-*` (`use-activity`, `use-async-job`, `use-body-scroll-lock`, `use-grid-*`, `use-image-loaded`, `use-album-columns`).
- `components/providers/` — `catalog-context.tsx`.
- pure `lib/` — the remaining framework-agnostic utils.
- **Rename collisions:** `lib/paths.ts` → `lib/server/server-paths.ts` (server FS, collides with pure `shared/paths.ts`); the two `folder-browser.tsx` → `directory-picker.tsx` (disk) / `album-folder-view.tsx` (album); `download-service.ts` → `download-archive.ts` (it builds zips, doesn't touch the DB).
- Add `index.ts` barrels where a clean public surface helps; cross-area imports via barrels, within-area relative.
**Tests:** pure relocation — `pnpm -r test` green, tsc/eslint clean; an automated blob-diff confirms only import lines changed (the A3 method).

---

## Phase C — Polish + ownership doc

### C1 · Lint-enforceable codemods + DTO homing
A batch of small, mechanical, individually-verifiable fixes:
- `errorMessage(e: unknown): string` in `@lumio/shared` (`e instanceof Error ? e.message : String(e)`) → replace the **10** unsafe `(err as Error).message`; add an eslint ban on `as Error`.
- `countLabel(n, sing, plur)` → the **7** hand-rolled `${n} photo(s)` (also fixes their missing locale grouping).
- `apiPaths` map (or helpers) for the global route literals (`/api/catalogs`, `/api/features`, `/api/profile`).
- `lib/http.ts` `postJson`/`fetchJson` → the ~13 components hand-rolling `fetch(url, { method, headers, body })`; promote the existing private `postJson`.
- `new Error(\`${res.status} ${url}\`)` for the **7** empty `new Error()` fetch sentinels (free diagnostics).
- Extract the lone `watch.ts:112` `5000` to a named const.
- Promote `RelativeTime` out of the `settings/catalogs/[id]` route and use it (or one shared formatter) across the 3 timestamp displays.
- Move client-shared server-only DTO types (`FolderSummary`, etc.) into `@lumio/shared` so client components stop type-importing from server services.
**Tests:** `errorMessage`/`http` helpers unit-tested; the rest verified by tsc + existing suite + the new lint rules.

### C2 · Document single-tenant (Decision 2)
- A loud comment in `lib/server/with-auth.ts` (and/or `with-catalog.ts`) stating: auth checks *logged-in*, NOT catalog ownership — Lumio is single-admin by design; catalogs are intentionally global; the ownership model lands with multi-user.
- A matching comment on the `Catalog` model in `schema.prisma`.
- A short README note under the auth/deploy section.
**Tests:** docs-only; tsc/build unaffected.

---

## 3. Sequencing & rationale

Execute in order: **B1 → B2 → B3 → B4 → B5 → C1 → C2.** Logic/helper increments (B1–B4) first, in the current structure; the wide `lib/` move (B5) after they've settled; polish (C1–C2) last. Same "logic before mechanical move" discipline as A1/A2-before-A3 — if we pause, the high-value work is banked and only the cosmetic move/polish remains. B1 introduces `lib/server/` early (the route helpers live there); B5 completes the population of `lib/server/`/`lib/hooks/`.

Each increment: its own plan (writing-plans) → subagent-driven execution (implementer + spec review + code-quality review) → whole-increment review where wide → `pnpm -r test` workspace-green gate (the A1 lesson: never a single `--filter`).

## 4. Testing & verification

Behavior-preserving throughout. Per increment: new helpers get focused unit tests; the wide moves (B5) and component swaps (B4) lean on the full suite + tsc + the blob-diff "import-lines-only" check. The workspace gate is `pnpm -r test` (currently 791 green). Browser verification is auth-gated; B4 touches user-facing views (search/trash/upload toolbars) so flag those for a browser eyeball, like the Phase A lightbox.

## 5. Out of scope (deferred, recorded)

- pixi.js rebuild.
- Feature-first co-location of services (Decision 1 chose layered; revisit per-feature later).
- Building `Catalog.userId`/multi-tenancy (Decision 2 — lands with multi-user).
- Internal `ZoomableImage` slimming (pixi supersedes it).
