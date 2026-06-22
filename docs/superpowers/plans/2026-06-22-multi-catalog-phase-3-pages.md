# Multi-Catalog — Phase 3: Pages, Client Wiring & Settings Reorg — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkboxes (`- [ ]`) for steps.

**Goal:** Move all catalog-scoped pages under `/c/[catalog]/…`, give the client an active-catalog context + slug-prefixed API URLs, add a catalog switcher + root redirect, and split settings into per-user **profile** vs per-catalog. After this phase `apps/web` type-checks fully (0 errors) and the app runs end-to-end against a catalog selected by the URL.

**Architecture:** A `c/[catalog]/layout.tsx` resolves the slug → catalog (404), and mounts a client `CatalogProvider` exposing `{ id, slug, name }`. Client components read `useCatalog()` and build API URLs via `catalogApiUrl(slug, path)` (→ `/api/c/<slug>/…`); `rendition-url` helpers take the slug. RSC pages resolve the catalog from their `params.catalog` and pass `catalog.id` into the (already-scoped) services. The sidebar nav becomes catalog-aware and gains a switcher; `/` redirects to `/c/<last-or-first>/photos`. `AppSettings` is retired: `uploadTemplate`→`Catalog`, `soundEffectsEnabled`→`UserSettings` (read via `/api/profile`).

**Tech Stack:** Next.js 16 App Router (RSC + client components), React context, Vitest.

**Prereqs / state:** Phases 1-2 done — all `/api/c/[catalog]/…` routes + scoped services exist; the only current `tsc` errors are the page-level ones this phase fixes. The destructive migration is still unapplied to the shared DB; for running/verifying, use a **workspace-local DB** (`lumio_multicatalog`): point this workspace's root `.env` `DATABASE_URL` at it and `prisma migrate deploy` (non-destructive to the shared `lumio`).

---

## File Structure

**Created:**
- `apps/web/src/lib/catalog-context.tsx` — `CatalogProvider` + `useCatalog()` (client context: `{ id, slug, name }`).
- `apps/web/src/lib/catalog-api.ts` — `catalogApiUrl(slug, path)` (+ `.test.ts`).
- `apps/web/src/app/(app)/c/[catalog]/layout.tsx` — resolve slug→catalog (404) + mount providers + sidebar.
- `apps/web/src/lib/active-catalog.ts` — server helper: resolve slug→catalog (cached), + last-used cookie read/write for the root redirect.
- Catalog switcher component (e.g. `apps/web/src/components/catalog-switcher.tsx`).

**Moved (under `app/(app)/c/[catalog]/`):** `photos`, `albums`, `albums/[id]`, `albums/folder/[id]`, `albums/folder/[id]/photos`, `favorites`, `search`, `upload`, `trash`, `photo/[id]`, and `settings` (now the *catalog* settings). Their `page.tsx` RSCs thread `catalog.id` into service calls.

**Restructured:**
- `apps/web/src/app/(app)/layout.tsx` — becomes the session-gate shell only; the sidebar + `LibraryTreeProvider` + `SoundSettingsProvider` move into `c/[catalog]/layout.tsx`.
- `apps/web/src/app/(app)/page.tsx` — redirect `/` → `/c/<last-or-first>/photos`.
- `apps/web/src/app/(app)/settings/page.tsx` → split: **profile** (sound effects) stays global; **catalog** tabs move under `c/[catalog]/settings`.
- `lib/rendition-url.ts` — `thumbUrl(slug, photo)`, `displayUrl(slug, photo)`, `baseDisplayUrl(slug, photo)` + every caller.
- All client fetch sites (see inventory in the brainstorm map) → slug-prefixed.
- `sound-settings-provider.tsx`, `sound-effects-form.tsx` → `/api/profile`; `upload-template-form.tsx` → `/api/c/[catalog]/settings`.

**Deleted/retired:** `packages/db/src/settings.ts` (`getSettings`/`updateSettings`); `AppSettings` model + a drop migration; remove `getSettings` from `(app)/layout.tsx`.

---

## Task P3.1 — Catalog context + client API helper + slug-aware rendition-url

- [ ] `catalog-context.tsx`: `CatalogProvider({catalog, children})` + `useCatalog()` returning `{ id, slug, name }` (throws if used outside provider).
- [ ] `catalog-api.ts` (TDD): `catalogApiUrl(slug, path)` → `/api/c/${encodeURIComponent(slug)}${path.startsWith("/") ? path : "/" + path}`. Test slug encoding + leading-slash handling.
- [ ] `rendition-url.ts`: add `slug` first arg to `thumbUrl`/`displayUrl`/`baseDisplayUrl`; `thumbUrl(slug, photo)` → `catalogApiUrl(slug, \`/photos/${photo.id}/thumbnail?v=${renditionVersion(...)}\`)` (note thumbnails moved under `/photos/[id]/thumbnail`); update `.test.ts`.
- [ ] Commit: `web: catalog context + slug-prefixed api/rendition helpers`.

## Task P3.2 — `c/[catalog]/layout.tsx` + app-shell restructure
- [ ] `active-catalog.ts`: `getCatalogForSlug(slug)` (cached `getCatalogBySlug`, `notFound()` if null); `getLastOrFirstCatalogSlug()` (cookie → else first catalog).
- [ ] `c/[catalog]/layout.tsx`: `const catalog = await getCatalogForSlug((await params).catalog)`; set the last-used cookie; mount `<CatalogProvider catalog={...}>` wrapping `AppSidebar` + `LibraryTreeProvider` + `SoundSettingsProvider` (sound seed now from `/api/profile`/`getUserSettings(session.user.id)`) + `{children}`.
- [ ] `(app)/layout.tsx`: keep the session gate (`getServerSession` → redirect `/login`); REMOVE `getSettings`; remove the sidebar/providers (moved down).
- [ ] Commit: `web: catalog layout resolves slug + hosts the app shell`.

## Task P3.3 — Move catalog-scoped pages + thread catalog.id into RSC service calls
- [ ] Move each page (table in File Structure) to `c/[catalog]/…`. In each RSC, resolve `catalog` via `getCatalogForSlug(params.catalog)` and pass `catalog.id` to the service: `getAlbum(catalog.id, id)`, `listFolderContents(catalog.id, …)`, `getFolder(catalog.id, id)`, `getPhoto(catalog.id, id)`, `loadPhotoDetail(catalog.id, id, scope)`, `getCatalogStats(catalog.id)`, etc. (Fixes the 11 page tsc errors.) `photo/[id]` keeps the modal/cache() pattern.
- [ ] Commit: `web: move catalog pages under /c/[catalog] + scope RSC loaders`.

## Task P3.4 — Slug-prefix every client fetch site
- [ ] For each client fetch (full inventory in the brainstorm map §2): read `useCatalog().slug`, build URLs via `catalogApiUrl(slug, …)`. Update endpoint props (`library-view`/`search-view`/`trash-view` `endpoint=`/`facetsEndpoint=`), `photo-collection-scope.ts`, `use-photo-pages`, `use-activity`, `use-async-job`, `library-tree`, photo-actions hooks, album/folder dialogs, upload-client, download-client, edit-session, lightbox-sidebar, `rendition-url` callers (pass slug). Activity polling → `/api/c/<slug>/activity`.
- [ ] Split into sub-batches by area (photos-grid, albums/folders, search/trash, upload/actions, settings) if large; each its own commit.
- [ ] Commit(s): `web: slug-prefix client API calls (<area>)`.

## Task P3.5 — Catalog switcher + nav + root redirect
- [ ] `app-sidebar.tsx`: nav hrefs become catalog-aware (`/c/${slug}/photos` …) using `useCatalog().slug`; active-match updated.
- [ ] `catalog-switcher.tsx`: lists catalogs (`GET /api/catalogs`), shows current, switch → `router.push(\`/c/${slug}/photos\`)`, + a "New catalog…" entry (wired in Phase 4). Place in the sidebar.
- [ ] `(app)/page.tsx` + a top-level redirect: `/` → `/c/<getLastOrFirstCatalogSlug()>/photos` (if no catalog exists → `/setup`, Phase 4).
- [ ] Commit: `web: catalog switcher + catalog-aware nav + root redirect`.

## Task P3.6 — Settings reorg + AppSettings retirement
- [ ] `c/[catalog]/settings/page.tsx`: catalog tabs — library folder (`catalog.path`), stats (`getCatalogStats(catalog.id)`/`getStorageSizes(catalog)`/`getPhotoFileCount(catalog)`), upload template (`upload-template-form` → `PUT /api/c/<slug>/settings`), indexing/rescan (`/api/c/<slug>/rescan`), danger zone (`/api/c/<slug>/photos/purge`).
- [ ] Profile settings: a global `/settings` (or fold into `/profile`) with the **sound effects** form → `PUT /api/profile`; `sound-settings-provider` seeded from `getUserSettings(session.user.id)`.
- [ ] Retire `AppSettings`: delete `packages/db/src/settings.ts`, remove the model from `schema.prisma`, add a migration `…_drop_app_settings` (`DROP TABLE "AppSettings"`), `prisma generate`; remove all `getSettings`/`updateSettings` imports. Update `@lumio/shared` `UpdateSettingsInput` if it still references both fields (split or remove).
- [ ] Commit: `web/db: settings reorg (profile vs catalog) + retire AppSettings`.

## Task P3.7 — Green-check + run
- [ ] `pnpm --filter @lumio/web exec tsc --noEmit 2>&1 | grep 'error TS' | grep -v calendar.ts` → **0 errors**.
- [ ] `pnpm -r test` → all green.
- [ ] (Live) point `.env` `DATABASE_URL` at `lumio_multicatalog`, `prisma migrate deploy`, start the dev server, confirm it builds + a catalog URL renders. Browser walkthrough is gated on a logged-in session (user-assisted) — deferred to the Phase 4 setup flow which creates the first catalog.
- [ ] Commit any fixups.

---

## Self-Review notes
- **Spec coverage:** pages under `/c/[catalog]` (P3.3) ✓; URL-as-source-of-truth + client context (P3.1-2) ✓; switcher + root redirect (P3.5) ✓; settings split + AppSettings retirement (P3.6) ✓; asset URLs now `/api/c/<slug>/photos/[id]/{thumbnail,display}` (P3.1) ✓. Deferred to Phase 4: setup gate + first-catalog wizard, `/catalogs` management page, folder-browser dialog, delete-mode prompt, switcher "New catalog".
- **Risk:** the client-fetch sweep (P3.4) is broad; the green `tsc` + tests gate catches missed sites that import slug-typed helpers, but bare `fetch("/api/…")` strings won't error — grep for residual `"/api/photos`, `"/api/albums`, etc. after P3.4 to confirm none remain unprefixed (except the 5 global groups).
- **DB:** use the workspace-local `lumio_multicatalog`; never apply the destructive migration to the shared `lumio` without explicit user coordination.
