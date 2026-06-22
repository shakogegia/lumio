# Multi-Catalog — Phase 4: Setup Wizard, Catalog Management & Folder Browser — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Checkboxes (`- [ ]`) for steps. This phase is UI-heavy — browser-verify with the user at the end.

**Goal:** Make catalogs creatable/manageable from the UI: a server-side folder browser dialog, a create-catalog flow, a first-run setup that forces creating the first catalog, a `/catalogs` management page (rename, delete with detach-vs-delete-originals prompt), and the switcher's "New catalog" entry. After this phase a fresh deploy can go from zero → admin account → first catalog → photos, entirely in the browser.

**Architecture:** A reusable `FolderBrowserDialog` drives `GET /api/fs/browse?path=` (bounded to `MEDIA_ROOT`) with breadcrumb navigation and a "use this folder" action. A `CreateCatalogDialog` pairs a name field with the folder browser and POSTs `/api/catalogs`. The setup gate (root redirect + `/setup`) routes a user with no catalog into a catalog-creation step. `/catalogs` lists catalogs with per-catalog stats and offers rename/delete; delete opens a prompt choosing detach-only vs delete-originals (`DELETE /api/catalogs/<id>?mode=`).

**Tech Stack:** Next.js App Router, React, shadcn/Base-UI dialog primitives (don't modify `ui/*`), the global API routes from Phase 2 (`/api/catalogs`, `/api/catalogs/[id]`, `/api/fs/browse`).

**Prereqs:** Phases 1-3 done; global routes exist; app runs against the workspace-local `lumio_multicatalog` DB.

---

## Task P4.1 — `FolderBrowserDialog` (reusable)
**Files:** `apps/web/src/components/folder-browser-dialog.tsx` (client) + a small hook/helper for the browse fetch.
- [ ] Dialog state: `currentPath` (starts at the browse root). On open / path change → `GET /api/fs/browse?path=<currentPath>` → `{ path, parent, dirs:[{name,path}] }`. Initial call with no `path` returns the `MEDIA_ROOT` listing.
- [ ] UI: a breadcrumb of the path segments (each clickable → navigate), an "up" affordance (uses `parent`, disabled at root), a scrollable list of subdirectories (click a row → navigate into it), and a footer with the current path + a primary "Use this folder" button that calls `onPick(currentPath)` and closes. Handle the 400 (outside-root) + empty-dir states. Loading state while fetching.
- [ ] Match the existing dialog styling (look at an existing dialog, e.g. `new-album-dialog.tsx` / `add-to-album-dialog.tsx`, reuse `@/components/ui/dialog`). Keyboard: Esc closes (dialog default).
- [ ] Commit: `web: reusable server folder-browser dialog`.

## Task P4.2 — `CreateCatalogDialog`
**Files:** `apps/web/src/components/create-catalog-dialog.tsx` (client).
- [ ] Fields: catalog **name** (text), catalog **folder** (read-only display of the picked path + a "Browse…" button opening `FolderBrowserDialog`). Submit POSTs `/api/catalogs` `{ name, path }`.
- [ ] On 400 → show the server `error` (e.g. "Folder overlaps an existing catalog", "Folder must be inside <MEDIA_ROOT>"). On 201 → call `onCreated(catalog)` (caller decides: redirect or refresh).
- [ ] Disable submit until name + folder are set. Commit: `web: create-catalog dialog (name + folder browser)`.

## Task P4.3 — First-run setup gate + first-catalog step
**Files:** `apps/web/src/app/(auth)/setup/*`, the root redirect (already `→ /setup` when no catalog), and the session/`hasAnyUser`/catalog-count checks.
- [ ] Setup gate logic: `/setup` decides which step to show — **no user** → the admin-account form (existing `SetupForm`); **user exists but no catalog** → the first-catalog step; **both exist** → `redirect("/")`. (`hasAnyUser()` exists; add a catalog-count check via `listCatalogs()`.)
- [ ] `SetupForm` (account): after successful signup, instead of `router.replace("/photos")`, advance to the catalog step (re-render `/setup` which now sees a user + no catalog, or push to a `?step=catalog`). 
- [ ] First-catalog step: a focused version of the create-catalog form (name + folder browser) styled for the `(auth)` two-column shell. On create → `router.replace(\`/c/${catalog.slug}/photos\`)` (the worker's reconcile loop picks up the new catalog and indexes it; the page shows photos as they import).
- [ ] Confirm `proxy.ts` / `(auth)` layout don't block the catalog step for an authenticated-but-catalogless user. Commit: `web: setup wizard forces first-catalog creation`.

## Task P4.4 — `/catalogs` management page + switcher wiring
**Files:** `apps/web/src/app/(app)/catalogs/page.tsx` (global, session-gated, NOT under `c/[catalog]`), a client list/table, a delete-prompt dialog; wire `catalog-switcher.tsx`'s "New catalog".
- [ ] Page lists all catalogs (`listCatalogs()` server-side or `GET /api/catalogs`) with name, folder path, and per-catalog stats (photo count — `getCatalogStats(id)`; optionally sizes). A "New catalog" button → `CreateCatalogDialog` (on created → refresh + optionally navigate).
- [ ] Per-row actions: **rename** (inline or small dialog → `PATCH /api/catalogs/<id>`), **delete** → a prompt dialog explaining the two modes and choosing one → `DELETE /api/catalogs/<id>?mode=detach|delete-originals` (clear, scary copy for delete-originals; default = detach). On delete of the active catalog, redirect to `/` (root picks another).
- [ ] Switcher: the "New catalog…" entry opens `CreateCatalogDialog` (or links to `/catalogs`); on created → `router.push(\`/c/${slug}/photos\`)`.
- [ ] This global page needs an app shell — give it a minimal header/back-nav (it's outside the catalog sidebar; or mount a slim sidebar variant). Keep it simple. Commit: `web: /catalogs management page + switcher new-catalog`.

## Task P4.5 — Green-check + browser walkthrough
- [ ] `pnpm --filter @lumio/web exec tsc --noEmit` → 0; `pnpm -r test` → green; lint changed files.
- [ ] Browser walkthrough (user-assisted, against `lumio_multicatalog`): fresh DB → `/` → `/setup` → create admin → forced first-catalog step → pick a folder via the browser → land in `/c/<slug>/photos` → photos import. Then: create a 2nd catalog from the switcher; switch between them; per-catalog settings/stats; rename; delete (both modes). Record a GIF of the setup flow if useful.
- [ ] Commit any fixups.

---

## Self-Review notes
- **Spec coverage:** folder browser (P4.1) ✓; create catalog (P4.2) ✓; setup forces first catalog (P4.3) ✓; `/catalogs` management + rename + delete-mode prompt (P4.4) ✓; switcher "New catalog" (P4.4) ✓. With this, the full spec is implemented.
- **Browse root:** `/api/fs/browse` defaults to `MEDIA_ROOT`; in the local dev DB that's `/Users/gego/Developer/lumio/data`, so the browser starts there and `photos/` is selectable.
- **Deferred/optional (YAGNI):** re-pointing a catalog's folder after creation; moving photos between catalogs; per-catalog sizes in the list if slow (lazy-load like the settings page does).
- **Delete-originals UX:** make the destructive option unmistakable (type-to-confirm or a distinct red button); it runs `purgeAllPhotos` server-side (synchronous — note the timeout caveat for huge catalogs, follow-up to make it a job).
