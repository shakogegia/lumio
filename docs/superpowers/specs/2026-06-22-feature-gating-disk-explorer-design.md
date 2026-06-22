# Feature-enablement architecture + Disk Explorer

**Status:** Approved (design) · **Date:** 2026-06-22

## Summary

Two deliverables, built together because an abstract flag system with no consumer
is untestable:

1. **A feature-enablement architecture** — a clean, extensible way to declare
   features, toggle them from settings at the right scope (global app-wide and/or
   per-catalog), and gate UI/API on them.
2. **The Disk Explorer** — a dedicated page that browses a catalog's folders and
   files on disk. It is the *first real feature* built on the architecture, which
   proves the architecture works.

Star ratings (future) and a favorites retrofit are explicitly **out of scope** —
they become a one-line registry addition later, which is the whole point.

## Motivation

Lumio is about to grow several optionally-enabled features (disk explorer now,
star ratings soon, favorites already exists). Building each with its own ad-hoc
on/off mechanism produces inconsistency and a messy unification later. Three real
consumers (favorites, disk explorer, star ratings) is exactly the "rule of three"
inflection point where the abstraction pays off rather than being speculative. The
disk explorer is the ideal first consumer: brand-new and self-contained, so gating
it from day one is zero-risk.

## Decisions (locked during brainstorming)

- **Toggle model: A — instance/admin-level "feature availability."** Flipping a
  feature changes what the whole app exposes (for everyone). Not a per-user
  preference. (Lumio is effectively a single-admin instance today.) A per-user
  layer can be added later without rework.
- **Scope model: per-feature declared scopes.** Each feature declares whether it
  is toggleable `global`, `catalog`, or both.
- **Resolution rule:** `default` in the registry is the **global** default. The
  per-catalog scope defaults to **inherit (enabled)** — a catalog row exists only
  to *opt that catalog out*. Effective state = `globalEnabled && catalogEnabled`.
  So: flip global ON → on for all catalogs → optionally turn specific catalogs off.
- **Persistence: Approach 1 — one generic `FeatureSetting` table.** Adding future
  features never touches the schema.
- **Disk explorer:** a **dedicated page** (not a flyout), per-catalog (browses
  *that catalog's* directory tree, bounded to its path), with a global master
  switch on top. Shows **all** entries (subfolders + every file); indexed photos
  get a thumbnail and open in the lightbox, other files are generic non-openable
  rows.

## Current-state grounding

- **Settings IA:** a 76px settings rail with Account / Catalogs / Users;
  `/settings` redirects to `/settings/catalogs`.
- **Storage today:** `UserSettings` (per-user, just `soundEffectsEnabled`) +
  per-catalog config as columns on `Catalog` (e.g. `uploadTemplate`). **No
  app-wide/global settings store exists yet** — this design introduces the first
  one (the global Features section).
- **Existing fs browsing:** `GET /api/fs/browse` + `folder-browser.tsx` browse the
  filesystem under `MEDIA_ROOT` (directories only, used to pick a catalog's
  directory). The disk explorer is a *new, catalog-scoped, files-included* browser
  — it does not replace that.
- **Photo model:** `Photo.path` with `@@unique([catalogId, path])`; `Catalog.path`
  is the catalog's root directory. The fs endpoint matches on-disk files to indexed
  photos via `Photo.path`. (Implementation note: confirm whether `Photo.path` is
  absolute or relative to `Catalog.path` and match accordingly.)
- **Provider pattern to mirror:** `LibraryTreeProvider` (context + an
  `invalidate*()` window event so mutations refresh consumers live).
- **Enums:** use TS `enum`s (project preference), not `as const` arrays.

## Architecture (layers)

```
@lumio/shared   features.ts          registry (pure, no deps): keys, scopes, defaults, metadata
@lumio/db       features-service.ts  resolveFeatures(catalogId), setFeature, isFeatureEnabled
apps/web  API   /features, /fs       read resolved map, write toggles, browse a catalog dir
apps/web  client FeaturesProvider    useFeature(key); SSR-seeded to avoid flash
apps/web  UI    settings + sidebar + /folders page
```

## A. Data model — one new table

```prisma
model FeatureSetting {
  id         String   @id @default(cuid())
  featureKey String
  catalogId  String?          // null = global switch; non-null = per-catalog override
  catalog    Catalog? @relation(fields: [catalogId], references: [id], onDelete: Cascade)
  enabled    Boolean
  updatedAt  DateTime @updatedAt

  @@unique([featureKey, catalogId])
}
```

- No row ⇒ fall back to the registry default (global) / inherit-on (catalog).
- `Catalog` gains the back-relation `featureSettings FeatureSetting[]`.
- Migration recipe must follow the project's shared-DB convention (see project
  memory — the shared dev Postgres on :5433; do not reset/backfill).

## B. Feature registry — `@lumio/shared/features.ts` (pure)

```ts
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
  default: boolean; // the GLOBAL default
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

export type FeatureMap = Record<FeatureKey, boolean>;
```

v1 ships **one fully-wired feature** (DiskExplorer, both scopes — which alone
exercises global *and* catalog resolution). Adding favorites/star ratings later is
a registry entry + (for favorites) gating the existing UI.

## C. Resolver + server gate — `@lumio/db/features-service.ts`

- `resolveFeatures(catalogId): Promise<FeatureMap>` — for each registry feature:
  - `globalEnabled = globalRow?.enabled ?? def.default`
  - if scope includes `Catalog`: `catalogEnabled = catalogRow?.enabled ?? true`
    (inherit); else `catalogEnabled = true`
  - `effective = globalEnabled && catalogEnabled`
- `setFeature({ key, catalogId, enabled }): Promise<void>` — upsert on the unique
  key; validate `key` against the registry and that the requested scope
  (`catalogId === null ? Global : Catalog`) is in the feature's `scopes`.
- `isFeatureEnabled(catalogId, key): Promise<boolean>` — convenience for route and
  page guards (resolves the map, reads one key).

## D. API surface

- `GET /api/c/[catalog]/features` → `FeatureMap` (the resolved effective map for
  the active catalog; the provider's refetch source). Uses `withCatalog`.
- `PUT /api/features` body `{ key, catalogId: string | null, enabled }` → writes
  one toggle. `withAuth`. `400` on unknown key or a scope not allowed for that
  feature.
- `GET /api/c/[catalog]/fs?path=<rel>` →
  `{ path, parent, breadcrumbs: {name,path}[], dirs: {name,path}[], files: FileEntry[] }`
  where `FileEntry = { name, size, mtime, isImage, photoId: string | null }`.
  - `path` is **relative to the catalog root**; default = catalog root.
  - Bounded to the catalog's own directory via the existing traversal guard
    (`originalPath`-style resolve + prefix check). Outside/invalid ⇒ `400`;
    missing dir ⇒ `404`.
  - Files are matched against indexed `Photo` rows (by path) so indexed photos
    carry a `photoId` (→ thumbnail + lightbox).
  - Gated: `isFeatureEnabled(catalog.id, DiskExplorer)` false ⇒ `404`.

## E. Client provider — `FeaturesProvider` + `useFeature`

- Mirrors `LibraryTreeProvider`: a context holding the `FeatureMap`, plus an
  `invalidateFeatures()` window event so settings toggles refresh consumers live.
- **SSR-seeded:** the `(app)` layout (or the active-catalog layout) calls
  `resolveFeatures` server-side and passes the map as the provider's initial value
  → **no flash** of the Folders nav item on first paint.
- `useFeature(key: FeatureKey): boolean`.

## F. Settings UI

- **New global "Features" section** in the settings rail → `/settings/features`
  (the first piece of the future "global settings"). Lists each registry feature
  with its **global** switch. Add a `Settings2`/`ToggleRight`-style icon item to
  `settings-sidebar.tsx` `ITEMS`.
- **Per-catalog toggles** on the catalog detail page (`/settings/catalogs/[id]`):
  a "Features" card listing catalog-scoped features, each defaulting to inherit/on,
  **shown only when that feature's global switch is on** (global is the master).
- Both write via `PUT /api/features` and call `invalidateFeatures()`.

## G. Disk Explorer page — `/c/[catalog]/folders?path=<rel>`

- **Gated:** the page server-checks `isFeatureEnabled` ⇒ `notFound()` if off. A new
  **"Folders"** rail icon (e.g. `FolderTree`/`Folder`) is added to
  `app-sidebar.tsx` `PRIMARY` and rendered only when `useFeature(DiskExplorer)` is
  true.
- **Layout:** a file-manager view —
  - **Breadcrumb:** catalog root → … → current directory (each segment links to
    `?path=`).
  - **Subfolders:** folder tiles/rows; click navigates deeper (`?path=`).
  - **Files:** indexed photos render a thumbnail and open in the lightbox on click;
    other files render a generic row (name + size, non-openable).
- Current directory is carried in the `?path=<rel>` query param (matches the
  existing fs/browse style); default = catalog root.

## H. Testing & error handling

- **Pure unit tests:**
  - Registry integrity (every key present, scopes non-empty).
  - Resolver resolution matrix: default; global-off kills everything; catalog
    opt-out; global-on + catalog-inherit; the AND.
  - Breadcrumb builder; fs path-safety (traversal blocked) + photo matching
    (indexed vs non-indexed, image vs non-image).
  - `setFeature` scope validation (reject disallowed scope / unknown key).
- **Errors:** disabled feature → page `notFound()` / API `404`; bad or
  out-of-bounds path → `400`; unknown feature key or disallowed scope → `400`.

## I. Out of scope (deferred)

- Per-user preference layer (toggle model C).
- Favorites retrofit (gate the existing favorites UI on a `Favorites` registry
  entry).
- Star ratings (new feature; future registry entry + its own spec).
- Non-catalog / whole-`MEDIA_ROOT` browsing.

## Open implementation notes

- Confirm `Photo.path` absolute-vs-relative before writing the file→photo match.
- Follow the shared-DB migration recipe; do not reset or backfill the shared dev
  Postgres.
