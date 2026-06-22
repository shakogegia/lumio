# Unified settings area

## Problem

Catalog management, per-catalog settings, and the user profile each live in
their own disconnected place. After shipping multi-catalog support this feels
scattered: "Manage catalogs" hangs off the catalog-switcher flyout, "Settings"
(which is secretly *per-catalog*) and "Profile" hang off the More menu, and none
of them share a navigation model. We want one centralized settings area with its
own sidebar.

## Goal

A single full-page settings area at `/settings/*` with its own left sidebar.
This round delivers the navigation shell plus three live sections:

- **Account** — the existing Profile page, relocated.
- **Catalogs** — manage-catalogs list, now **drag-to-reorder** with persisted
  order, and each catalog drills into its own per-catalog settings.
- **Users** — a read-only list of registered users (new).

Explicitly **deferred** (no empty placeholder sections — added when there is
real content):

- **App settings** — the `AppSettings` table was dropped (migration
  `20260622130000_drop_app_settings`); there is no global app config to surface
  yet. Theme and sound are per-*user* and belong under Account, not here.
- **Logs** — there is live worker *activity* but no log store or viewer; its own
  future spec.

## Key decisions

1. **Per-catalog settings fold into Catalogs as a drill-down.** Today's
   `c/[catalog]/settings` (stats, indexing, uploads, danger zone) only makes
   sense with a catalog selected, so it becomes the detail view of a catalog in
   the Catalogs list rather than an orphan top-level "Settings". This is the
   thing that bothered us — there is no longer a "Settings" that secretly means
   "this catalog".
2. **Profile folds in as "Account".** One unified place; the More-menu "Profile"
   link points here.
3. **Full-page route group, its own sidebar.** Opening settings swaps the 76px
   photo rail for the settings sidebar; a "Back to photos" affordance returns
   you. This matches the existing pattern — `(app)/catalogs` and
   `(app)/profile` are already full pages outside the catalog layout — and is
   cleanly deep-linkable, so the in-catalog "Settings" link can jump straight to
   a catalog's page.
4. **Custom catalog order is the single source of order everywhere.** The
   catalog-switcher flyout lists catalogs in the same drag-defined order as the
   management list, not just the list itself.
5. **Reorder interaction uses native HTML5 `draggable`** (matching the existing
   folder browser), with the `fractional-indexing` package only for computing
   ordering keys. No heavy DnD dependency. (dnd-kit remains an option later if
   keyboard a11y / animation become priorities.)

## Architecture

### Routing & layout

New route group `apps/web/src/app/(app)/settings/`:

| Route | Purpose |
| --- | --- |
| `layout.tsx` | Renders `SettingsSidebar` + content area. Session gating is inherited from the parent `(app)/layout.tsx`. The layout itself is catalog-agnostic. |
| `page.tsx` | Redirects `/settings` → `/settings/catalogs`. |
| `account/page.tsx` | Relocated Profile (moves `profile/*` support files here). |
| `catalogs/page.tsx` | Sortable catalog list (replaces `(app)/catalogs`). |
| `catalogs/[id]/page.tsx` | Per-catalog settings, loaded **by id**, breadcrumb "Catalogs / *name*" (relocated from `c/[catalog]/settings`). |
| `users/page.tsx` | Read-only user list. |

Removed routes: `(app)/catalogs`, `(app)/profile`, `(app)/c/[catalog]/settings`.
Links are repointed; **no legacy redirects** (personal app, YAGNI).

### Navigation / entry points

- **`SettingsSidebar`** (new component): a wider, labeled left rail — Account ·
  Catalogs · Users — with active state by pathname, plus a header containing a
  "Back to photos" affordance that returns to the remembered catalog (falling
  back to `/`).
- **More menu** (`sidebar-more.tsx`):
  - "Profile" → `/settings/account`.
  - "Settings" → `/settings/catalogs/<currentCatalogId>` (deep-link to *this*
    catalog's page).
  - Theme / Trash / Log out unchanged.
- **Catalog switcher** (`catalog-switcher.tsx`): "Manage catalogs" →
  `/settings/catalogs`. The flyout list is rendered in custom order (it already
  fetches `/api/catalogs`, which will return position-ordered rows).

### Catalogs section

**List page** (`catalogs/page.tsx` + client list):

- Catalogs rendered in custom order; each row drills into
  `/settings/catalogs/[id]`.
- **Drag-to-reorder** via native `draggable` + a drag handle. On drop, compute a
  fractional key between the destination's neighbors with `fractional-indexing`
  and `PATCH /api/catalogs/[id]` with `{ position }` for the single moved row.
  Optimistic update; reconcile on response.
- Existing per-row actions (rename, delete) and "New catalog" are preserved.

**Detail page** (`catalogs/[id]/page.tsx`): today's per-catalog settings content
unchanged — stats (photos, files on disk, storage sizes, last updated),
Indexing/rescan, Uploads template, Danger zone (delete all photos) — but loaded
by catalog **id** instead of slug. Needs a `getCatalogById`-style lookup.

### Users section

Read-only table: **Name · Email · Joined · 2FA**. RSC reads a new
`listUsers()` from `@lumio/db` directly (no API route needed). No row actions
this round.

### Account section

Today's Profile content moved verbatim (account form, password form, two-factor
section, sessions list, sound-effects form) into `settings/account/`.

### Data / DB

- **`Catalog.position String?`** — nullable, additive column. Safe for the
  shared dev DB (no destructive change; see `lumio-shared-db-drift` /
  `lumio-multi-catalog` memories — generate the migration additively, never
  reset/backfill destructively).
- **`listCatalogs`** orders by `position` (nulls last), then `createdAt`. So
  existing rows keep current ordering until first reorder.
- **Idempotent backfill**: assign fractional keys to any null-`position`
  catalogs in `createdAt` order (e.g. `generateNKeysBetween(null, null, n)`).
  Runs once on migrate. New catalogs get an appended key at creation
  (`generateKeyBetween(lastKey, null)`).
- **`PATCH /api/catalogs/[id]`** extended to accept an optional `position`
  (alongside existing `name`); body becomes `{ name?, position? }`.
- **`listUsers()`** added to the db package — returns `{ id, name, email,
  createdAt, twoFactorEnabled }`.

## Testing

- Unit: fractional key generation for the reorder helper — insert between two
  rows, move to first, move to last, single-item list, and the null-neighbor
  backfill path.
- Unit: `listCatalogs` ordering (position asc, nulls last, then createdAt).
- Unit: `listUsers` returns the expected serializable shape.
- Follow existing vitest patterns in `packages/db` and `apps/web`.

## Out of scope

- App settings section and Logs section (deferred above).
- User management actions (invite, edit roles, delete) — list is read-only for
  now.
- Migrating the reorder interaction to dnd-kit / keyboard-accessible drag.
