# Share Links — Design Spec

**Date:** 2026-06-25
**Status:** Approved (brainstorm) — pending implementation plan
**Branch:** `gego/photo-share-links`

## Summary

Let the single admin select photos in a catalog and create a **public, unlisted
share link** (`https://<base>/share/<token>`). The link presents the selected
photos as a no-login gallery where recipients can browse, view large, and
download — individual files and a "download all" zip — always with the admin's
edits **baked in** and reflecting each photo's **current** state.

Links are **catalog-scoped**, **revocable**, and support **optional expiry and
password** behind an "Advanced" disclosure. Sharing is a **global feature flag**
(default off) and requires a **Public base URL** app setting before any link can
be created.

## Goals

- Select photos → one-click create a shareable public gallery link.
- Recipients (no account): browse, view large, download individual + zip.
- Downloads deliver full-resolution JPEGs with edits baked in.
- Live references: later edits show in the shared gallery; deleted/trashed
  photos drop out automatically.
- Per-link optional expiry and optional password (advanced options).
- Revoke any link at any time; see a list of active links.
- Global enable/disable in Settings → Features.
- App-wide **Public base URL** setting in a new Settings → General section.

## Non-goals (v1)

- Shared *albums* (a live album rendered as a link) — explicitly deferred; the
  user wants links first.
- Cross-catalog links (selection is catalog-scoped).
- Recipient uploads, comments, or any write access from the public side.
- Re-enabling a revoked link (revoke is a hard delete).
- An option to share untouched originals (downloads are baked-edited only, by
  design — consistent with "edits baked in").

## Key decisions (from brainstorm)

| Decision | Choice |
| --- | --- |
| Recipient capabilities | View + download (individual + zip) |
| Download rendition | Full-res JPEG, edits baked in |
| Access control | Unlisted link; revocable; optional expiry + password as "Advanced" |
| Public base URL | **Required** app setting; create blocked until set |
| Settings layout | Base URL in new **Settings → General**; enable toggle in existing **Settings → Features**; link management in the **app sidebar** |
| Enable scope | **Global** (one app-wide switch) |
| Snapshot semantics | **Live references** (store photo IDs; render current state) |
| Revoke | **Hard delete** the link row |
| Password handling | scrypt hash stored; unlock via short-lived signed cookie scoped to the token |
| Catalog scope | A link belongs to exactly one catalog |

## Architecture

The central choice is *how public access works*. Three approaches considered:

- **A) Dedicated `/share/<token>` namespace + DB-backed links — CHOSEN.** A
  separate public page and `/api/share/<token>/…` route group, guarded by a new
  `withShare` wrapper that mirrors the existing `withCatalog`. Authed routes are
  never modified, so there's no risk of exposing private endpoints. Revocation
  and listing fall out naturally from the DB table.
- **B) Token bypass inside `withCatalog` — rejected.** Every catalog route would
  begin accepting tokens; a single careless route becomes a data leak. Mixes
  public and private concerns in one wrapper.
- **C) Stateless HMAC-signed URLs (no table) — rejected.** Can't list active
  links or revoke without maintaining a denylist; password and gallery flows get
  awkward; doesn't satisfy the "management list" requirement.

### `withShare` wrapper

`withShare` resolves `token → ShareLink` and enforces, in order:

1. **Sharing feature enabled** (global kill-switch). Disabling the feature
   instantly disables all live links.
2. **Link exists and not expired** (`expiresAt` null or in the future).
3. **Password satisfied** when `passwordHash` is set — verified via the
   token-scoped unlock cookie.
4. **Requested photo belongs to the link** (membership check against
   `ShareLinkPhoto`) for per-photo routes.

On success it passes `{ shareLink, catalog, photoIds }` to the handler. Any
failure returns the appropriate public-safe response (404 / 401 / "no longer
available") without leaking which condition failed where it matters.

## Data model (Prisma)

Mirrors the existing `Album` / `AlbumPhoto` pattern.

```prisma
model ShareLink {
  id           String           @id @default(cuid())
  token        String           @unique          // ~22-char URL-safe random (128-bit entropy)
  catalogId    String
  catalog      Catalog          @relation(fields: [catalogId], references: [id], onDelete: Cascade)
  title        String?                            // optional gallery heading
  passwordHash String?                            // scrypt hash; null = no password
  expiresAt    DateTime?                          // null = never
  createdAt    DateTime         @default(now())
  updatedAt    DateTime         @updatedAt
  photos       ShareLinkPhoto[]

  @@index([catalogId])
}

model ShareLinkPhoto {
  shareLinkId String
  shareLink   ShareLink @relation(fields: [shareLinkId], references: [id], onDelete: Cascade)
  photoId     String
  photo       Photo     @relation(fields: [photoId], references: [id], onDelete: Cascade)

  @@id([shareLinkId, photoId])
  @@index([photoId])
}
```

- **Live references:** photo deletion cascades through `ShareLinkPhoto`, so a
  deleted/trashed photo drops out of the share. The gallery renders current
  renditions, so later edits appear automatically.
- **Revoke = delete the `ShareLink` row** (cascades its join rows).
- Relations added to `Catalog` (`shareLinks ShareLink[]`) and `Photo`
  (`shareLinks ShareLinkPhoto[]`).

### App settings store (new)

A generic key/value table so future global settings don't each require a
migration:

```prisma
model AppSetting {
  key       String   @id      // e.g. "publicBaseUrl"
  value     String
  updatedAt DateTime @updatedAt
}
```

Accessors in `@lumio/db`: `getAppSetting(key)`, `setAppSetting(key, value)`.

> ⚠️ The dev Postgres is shared across worktrees. Apply the migration using the
> project's careful migration recipe (see project memory) rather than a reset.

## Feature flag

Add `FeatureKey.Sharing` to the `FEATURES` registry in `@lumio/shared`:

- **Scope:** global. **Default:** off.
- **Gates:** the Share button in the selection toolbar, the "Shared" sidebar
  entry, the create/list/delete APIs, and the public `withShare` wrapper.

## Settings UI

### Settings → General (new tab)

- **Public base URL** field — validated as an absolute `http(s)` origin (no
  trailing path required; trailing slash trimmed). Stored in
  `AppSetting["publicBaseUrl"]`.
- Read/write via a new `GET`/`PUT /api/settings/general` route.
- **Required for sharing:** creating a link fails with a clear message
  ("Set your Public base URL in Settings → General first") and the Share dialog
  links to this page when the value is missing.

### Settings → Features (existing)

- The **Enable Sharing** toggle appears automatically once `FeatureKey.Sharing`
  is registered (global feature, rendered by the existing features UI).

## Creating a link (authenticated)

- Add a **Share** action to `SelectionActions`, gated by `FeatureKey.Sharing`,
  positioned beside Download.
- Opens a **Create-link dialog**:
  - **Title** (optional).
  - **Advanced** disclosure (collapsed by default): **Expires**
    (Never / 7 days / 30 days / custom date) and **Password** (optional).
- `POST /api/c/<catalog>/share-links` with `{ photoIds, title?, expiresAt?,
  password? }`:
  - `400` if base URL not configured, with an error code the client maps to the
    "set base URL" message (and a link to Settings → General).
  - Generate a unique URL-safe token; hash the password with scrypt if provided;
    insert `ShareLink` + `ShareLinkPhoto` rows.
  - Return the full absolute URL (`<publicBaseUrl>/share/<token>`).
- The dialog displays the URL with a **Copy** button.

## Managing links (authenticated)

- New catalog-scoped sidebar entry **"Shared"** at `/c/<catalog>/shared`, gated
  by the feature flag, listing that catalog's links:
  - First-photo thumbnail / title, photo count, created date, expiry + password
    badges.
  - **Copy** and **Revoke** (delete) actions.
- Backed by `GET /api/c/<catalog>/share-links` and
  `DELETE /api/c/<catalog>/share-links/<id>`.

## Public gallery (unauthenticated)

- Page at `app/share/[token]/page.tsx` — outside the `(app)` and `(auth)` route
  groups, so it renders without the authenticated app chrome.
- **Password gate:** if the link is password-protected and not yet unlocked,
  render a password prompt → `POST /api/share/<token>/unlock` verifies the
  password and sets a short-lived **signed cookie scoped to that token**;
  subsequent list/image requests check the cookie.
- **Public routes** (all guarded by `withShare`), mirroring the authed
  renditions:
  - `GET /api/share/<token>/photos` — paginated list (id, dimensions,
    thumbhash).
  - `GET /api/share/<token>/photos/<id>/thumbnail` — gallery thumbnail.
  - `GET /api/share/<token>/photos/<id>/display` — large display rendition
    (edited).
  - `GET /api/share/<token>/photos/<id>/download` — full-res baked JPEG
    (reuses `encodeEditedJpeg` + `decodeToSharpInput`).
  - `GET /api/share/<token>/download-all` — edited zip (reuses
    `streamPhotosZip(photos, name, "edited", resolve)`).
- **UI:** reuses the existing photo-grid visual styling plus a lightbox; header
  shows the link title; a "Download all" button; minimal Lumio branding.
- **Unavailable state:** expired, revoked, or feature-disabled links render a
  friendly "This link is no longer available" page (not a raw 404/JSON).

## Reuse map (existing code this builds on)

- `encodeEditedJpeg`, `decodeToSharpInput` (`@lumio/ingest`) — baked single-photo
  download.
- `streamPhotosZip(..., "edited", ...)` (`apps/web/src/lib/server/download-archive.ts`)
  — baked "download all" zip; already supports the edited variant.
- `attachmentDisposition`, `jpegName`, `sanitizeZipName` — download headers/names.
- `withCatalog` (`apps/web/src/lib/server/with-catalog.ts`) — pattern to mirror
  for `withShare`.
- `FEATURES` registry + `FeatureGate` — feature flag + conditional rendering.
- `SelectionActions` (`apps/web/src/components/photo-actions/selection-actions.tsx`)
  — where the Share button lands.
- `AppSidebar` (`apps/web/src/components/app-sidebar.tsx`) — where the "Shared"
  nav item lands (catalog-scoped, feature-gated).

## Testing strategy

- **Unit**
  - Token generation: format and uniqueness.
  - `withShare` enforcement matrix: feature off / expired / wrong password /
    photo-not-in-link / happy path.
  - Password hash + verify round-trip.
  - Public base URL validation (accept/reject cases; trailing-slash trim).
- **Integration**
  - Create link → fetch public list / thumbnail / display / download → revoke →
    subsequent requests fail (unavailable).
  - Expiry boundary (just-before vs just-after).
  - Global feature kill-switch disables a live link.
  - Deleted photo drops out of an existing link.
  - Download-all zip contains baked edits for edited photos, originals
    otherwise.

## Open questions

None outstanding — all brainstorm questions resolved.
