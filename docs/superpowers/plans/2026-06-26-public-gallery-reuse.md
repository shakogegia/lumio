# Public Gallery — Reuse PhotoGrid + Lightbox (clean, provider-based)

> Extends the share-links feature: the public `/share/<token>` gallery reuses the **real** `PhotoGrid` + `Lightbox` (zoom, filmstrip, grid size/view, selection, download, context menu) instead of the standalone gallery — minus edit/info/favorite/trash/album. Done via dependency injection (two providers + a capabilities context), NOT `readOnly` flag-soup. Authed app behavior is preserved by defaults.

**Architecture:**
- **RenditionProvider** — single source of rendition image URLs (`thumb/display/base/full`). `CatalogRenditionProvider` (default, from `useCatalog().slug`, byte-identical to today's URLs) seeded in the catalog layout; `ShareRenditionProvider` (token) on the public page. Removes hardcoded `thumbUrl(slug,…)`/`displayUrl(slug,…)` from PhotoThumb / ZoomableImage / FilmStrip / collection preload.
- **PhotoCapabilities context** — declares what the surface allows (`download`, `favorite`, `trash`, `edit`, `addToAlbum`, `setCover`, `createShare`, `details`). Default = all true (authed unchanged). Public = `download` + `downloadAll` only. The action UIs render each control only when its capability is present (no `readOnly` booleans).
- Public page = `ShareRenditionProvider` + `CatalogProvider` shim (slug=token) + restricted `PhotoCapabilitiesProvider` + public `PhotoActionsProvider` wrapping the real `PhotoGrid` + `Lightbox` + grid menus + brand logo.

**Hard rule:** every change is **additive with catalog defaults preserved**. After the two risky refactors (RG3, RG4) run the full `@lumio/web` test suite + `next build` and confirm authed URL output is unchanged.

---

## File map

**Create:**
- `apps/web/src/app/api/share/[token]/photos/[id]/full/route.ts` — inline full-res baked JPEG (zoom source)
- `apps/web/src/app/api/share/[token]/photos/download/route.ts` — POST subset zip (download selected)
- `apps/web/src/features/photo-grid/rendition-context.tsx` — `RenditionUrls` type, `RenditionProvider`, `useRenditions`, `CatalogRenditionProvider`
- `apps/web/src/app/share/[token]/share-rendition-provider.tsx` — `ShareRenditionProvider`
- `apps/web/src/components/photo-actions/photo-capabilities.tsx` — `PhotoCapabilities`, `PhotoCapabilitiesProvider`, `usePhotoCapabilities` (default all-true)
- `apps/web/src/app/share/[token]/share-photo-actions.tsx` — public `PhotoActionsProvider` value (download-only)

**Modify:**
- `apps/web/src/app/(app)/c/[catalog]/layout.tsx` — seed `CatalogRenditionProvider`
- `apps/web/src/features/photo-grid/photo-thumb.tsx` — use `useRenditions().thumb`
- `apps/web/src/features/lightbox/film-strip.tsx` — use `useRenditions().thumb`
- `apps/web/src/features/photo-grid/photo-collection.tsx` — preload via `useRenditions().display`
- `apps/web/src/features/photo-editor/zoomable-image.tsx` — display/base/full via `useRenditions()`
- `apps/web/src/components/photo-actions/selection-actions.tsx` — gate by capabilities
- `apps/web/src/features/photo-grid/photo-context-menu.tsx` — gate by capabilities
- `apps/web/src/features/lightbox/lightbox-actions.tsx` (+ `lightbox-header.tsx`) — gate by capabilities
- `apps/web/src/features/lightbox/lightbox.tsx` / `lightbox-sidebar.tsx` — gate sidebar by `caps.details`
- `apps/web/src/app/share/[token]/page.tsx` — render the real grid/lightbox shell
- `apps/web/src/app/share/[token]/share-unavailable.tsx`, `share-password-gate.tsx` — add logo
- Delete `apps/web/src/app/share/[token]/share-gallery.tsx` (replaced)

---

## RG1 — Public full-res + subset-zip routes

**Files:** create `…/photos/[id]/full/route.ts`, `…/photos/download/route.ts`.

- **full** mirrors the share `download` route (Task 16) — `withShare` + `shareLinkPhotoExists` + `getPhoto` (live) + `decodeToSharpInput`/`encodeEditedJpeg`/`wbBaselineOf` — but serves **inline** (no `Content-Disposition`) with `Cache-Control: private, max-age=300` so the zoom `<img>` can load it.
- **download** (POST) parses `{ ids: string[] }` (reuse `photoIdsSchema` from `@lumio/shared`), intersects ids with the link's live members (filter `listShareLinkPhotosForDownload` by the requested set, or query `photo.findMany` where `catalogId + LIVE_PHOTO + shareLinkPhotoWhere + id in ids`), then `streamPhotosZip(photos, name, "edited", resolve)`. Guard: ignore ids not in the link (never zip non-members).

Add a service helper `listShareLinkPhotosForDownloadSubset(catalogId, shareLinkId, ids, db)` to share-links-service (mirrors `listShareLinkPhotosForDownload` + `id: { in: ids }`), unit-tested.

Verify: lint + (service helper) vitest.

---

## RG2 — RenditionProvider + Catalog default (no consumer changes yet)

**Files:** create `rendition-context.tsx`; modify catalog `layout.tsx`.

`RenditionUrls`:
```ts
export interface RenditionUrls {
  thumb(photo: Pick<PhotoDTO, "id" | "updatedAt">): string;
  display(photo: Pick<PhotoDTO, "id" | "updatedAt">): string;
  base(photo: Pick<PhotoDTO, "id">): string;
  /** Full-res source used when zoomed. */
  full(photo: Pick<PhotoDTO, "id" | "updatedAt" | "edits">): string;
}
```
- `RenditionContext` + `useRenditions()` (throws if no provider — every photo surface must have one).
- `CatalogRenditionProvider`: reads `useCatalog().slug`, returns builders **byte-identical to today**:
  - `thumb` → `thumbUrl(slug, photo)`
  - `display` → `displayUrl(slug, photo)`
  - `base` → `baseDisplayUrl(slug, photo)`
  - `full` → today's ZoomableImage zoom source: `catalogApiUrl(slug, /photos/<id>/edited?v=…)` when `hasEdits(photo.edits)` else `/photos/<id>/original`. (Read zoomable-image.tsx to replicate its exact current logic.)
- Seed `<CatalogRenditionProvider>` inside `CatalogProvider` in the catalog layout (wrapping the existing children).

Verify: build (no behavior change yet).

---

## RG3 — Route consumers through useRenditions (RISKY — verify parity)

**Files:** `photo-thumb.tsx`, `film-strip.tsx`, `photo-collection.tsx`, `zoomable-image.tsx`.

Replace direct URL calls with `const r = useRenditions();` then:
- PhotoThumb: `r.thumb(photo)`.
- FilmStrip: `r.thumb({ id: item.id, updatedAt: ... })` — FilmStrip items carry `v` (the version number), not `updatedAt`. Add a `thumbVersioned(id, v)` method to `RenditionUrls` (catalog: `catalogApiUrl(slug, /photos/<id>/thumbnail?v=<v>)`) and use it here, to preserve the exact URL.
- PhotoCollectionProvider preload: `r.display(p)`.
- ZoomableImage: `display→r.display`, `base→r.base`, the zoom full-res source→`r.full(photo)`. Keep ZoomableImage's zoom/preload/crop logic otherwise unchanged; only swap the URL strings.

> Update `RenditionUrls` to include `thumbVersioned(id: string, v: number): string`.

**Verify (mandatory):** `pnpm --filter @lumio/web test` (476 pass) + `pnpm --filter @lumio/web build`. Spot-check that catalog URL output is identical (the provider returns the same strings). Manually confirm the authed editor zoom still loads (note in report if unable).

---

## RG4 — PhotoCapabilities context + gate the action UIs (default = all true)

**Files:** create `photo-capabilities.tsx`; modify `selection-actions.tsx`, `photo-context-menu.tsx`, `lightbox-actions.tsx` (+ `lightbox-header.tsx`), `lightbox.tsx`/`lightbox-sidebar.tsx`.

```ts
export interface PhotoCapabilities {
  download: boolean; downloadAll: boolean;
  favorite: boolean; trash: boolean; edit: boolean;
  addToAlbum: boolean; setCover: boolean; createShare: boolean;
  details: boolean; // info/EXIF/edit sidebar
}
const FULL: PhotoCapabilities = { download:true, downloadAll:true, favorite:true, trash:true, edit:true, addToAlbum:true, setCover:true, createShare:true, details:true };
```
- `usePhotoCapabilities()` returns the context value or `FULL` when no provider (so the authed app needs NO change to keep current behavior).
- Gate each control:
  - SelectionActions: `caps.favorite && <FavoriteButton/>`, `caps.addToAlbum && <AddToAlbumMenu/>`, `caps.download && <DownloadMenu/>`, `caps.trash && <Delete/>`, the Share button keeps `useFeature(Sharing)` AND `caps.createShare`.
  - photo-context-menu: same per-item gating; Color label under `caps.edit` (or a dedicated cap — use `caps.edit`); Set-cover under `caps.setCover && actions.albumCover`.
  - lightbox-actions: favorite/trash/edit gated; download gated by `caps.download`.
  - lightbox sidebar (+ the EditSession edit affordances): render only when `caps.details`.

**Verify:** `pnpm --filter @lumio/web test` + `build`. Authed app unchanged (default FULL).

---

## RG5 — Share rendition + public actions + capabilities value

**Files:** create `share-rendition-provider.tsx`, `share-photo-actions.tsx`.

- `ShareRenditionProvider token`: `RenditionUrls` over `/api/share/<token>/…` — `thumb`/`thumbVersioned`→`…/photos/<id>/thumbnail?v=`, `display`→`…/display?v=`, `base`→ same as display (no crop publicly), `full`→`…/photos/<id>/full`.
- Public `PhotoActions` value: real `download` (single → `…/photos/<id>/download`; multi → POST `…/photos/download` subset zip via a small client helper), plus a `downloadAll` link. The other `PhotoActions` methods are no-op stubs (never invoked — capabilities hide their controls); comment them clearly.
- Public capabilities: `{ download:true, downloadAll:true, everything else:false }`.

Verify: lint.

---

## RG6 — Rewrite the public gallery page with the real grid + lightbox + logo

**Files:** rewrite `share/[token]/page.tsx` (or a new client `share-gallery-view.tsx`), add logo to `share-unavailable.tsx` + `share-password-gate.tsx`, delete old `share-gallery.tsx`.

Public gallery client component:
```
<ShareRenditionProvider token>
  <CatalogProvider catalog={{ id: "share", slug: token, name: title ?? "Shared" }}>
    <PhotoCapabilitiesProvider value={PUBLIC_CAPS}>
      <header> <Logo/> {title} … grid menus … Download all </header>
      <PhotoCollectionProvider endpoint={sharePhotosEndpoint(token)} params urlForId={() => "#"} baseUrl="…" enableLightbox>
        <PhotoActionsProvider value={publicActions}>
          {publicActions.element?}  // none needed
          selection toolbar (when selected): "Download N" + cancel
          <PhotoGrid mode columns selectedIds onSelectionChange />
          <Lightbox />
        </PhotoActionsProvider>
      </PhotoCollectionProvider>
    </PhotoCapabilitiesProvider>
  </CatalogProvider>
</ShareRenditionProvider>
```
- Grid size/view via `useGridView()`/`useGridColumns()` + `GridViewMenu`/`GridSizeMenu` (pure).
- `urlForId`: the lightbox uses it to push a detail URL; for public there's no per-photo route, so pass a stable no-op (e.g. return current path) and rely on the in-memory lightbox (open/close via collection). Confirm the lightbox opens without navigation when `urlForId` is a no-op; if it requires a real URL, gate the deep-link push off for public (smallest tweak in photo-collection: skip history push when a `publicNoNav` flag/`urlForId` returns falsy — keep it minimal).
- Selection toolbar: minimal public bar — count + "Download" (calls publicActions.download on the selected ids) + cancel. Reuse `SelectionToolbar` shell.
- The page server component keeps its current resolve order (unavailable/gate/gallery); render the new client gallery in the success branch.
- Logo: `<Logo className="size-7" />` in the gallery header, the password gate, and the unavailable screen.

**Verify:** lint + build.

---

## RG7 — Final verification

- `pnpm --filter @lumio/web test` (all pass), `pnpm --filter @lumio/web lint` (0 errors), `pnpm --filter @lumio/web build` (ok).
- Manual (dev server): authed app — grid, lightbox zoom/filmstrip, editor zoom, selection toolbar, context menu all unchanged. Public incognito link — grid size/view, select + download selected (zip), per-photo download, zoom, filmstrip, context-menu download; NO edit/info/favorite/trash/album; logo present; password + unavailable screens show logo.

## Notes / risk
- RG3 + RG4 touch core authed components; defaults preserve behavior. Verify with tests+build after each; flag editor-zoom for manual retest.
- Public never exposes the untouched original — `full` serves the baked-edited full-res.
