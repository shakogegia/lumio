# Photo editing — design

**Date:** 2026-06-20
**Status:** Approved for planning
**Scope (phase 1):** rotate left, rotate right, flip horizontal, flip vertical.
**Foundation built now, used later:** crop (freeform + ratio presets), brightness, saturation, temperature.

## 1. Goal

Add non-destructive photo editing to Lumio. Edits are stored as a recipe, never mutate the
original file, and are visible everywhere in the app (grid + lightbox). The user can download
the edited version or the untouched original. Phase 1 ships rotate/flip; the data model, the
rendition pipeline, the Edit tab, and the split download are built so crop and the adjustment
sliders drop in later with no re-architecture.

## 2. Decisions (from brainstorming)

1. **Edits show everywhere** — saving regenerates the display + thumbnail renditions; the
   original is preserved purely as source + for "download original".
2. **Edit UI lives in the lightbox sidebar** as a third tab beside **Info** and **EXIF**.
3. **Live preview + explicit Apply** — rotate/flip update the center image instantly via CSS;
   nothing persists (no rendition regen, no thumbhash recompute) until **Apply**. A **Reset**
   clears the working recipe back to the original.
4. **Prompt on unsaved changes** — navigating to another photo / closing the lightbox with an
   un-applied edit asks the user to confirm discarding.
5. **Split download everywhere**, adaptive:
   - **Lightbox (single):** an edited photo gets a split button — primary click downloads
     **edited**, hover reveals a menu with "Download edited" / "Download original". An
     **unedited** photo keeps the plain Download button it has today (original).
   - **Context menu (bulk):** if the selection contains **any** edited photo → show **two**
     flat items, "Download N edited" and "Download N originals". If **none** are edited → show
     the **single** "Download N photos" item exactly as today. No nesting.
6. **Edited download format:** always **JPEG**, full resolution from the original, high quality.
   (Chosen for pipeline simplicity / speed; revisit later if format preservation is wanted.)
7. **Recipe storage:** a single `edits Json?` column on `Photo` (mirrors the existing
   `exif Json` precedent; no migration churn as crop/sliders are added).

## 3. Data model & types

### 3.1 Prisma (`packages/db/prisma/schema.prisma`)
Add to `model Photo`:
```prisma
edits Json?  // PhotoEdits recipe; null = unedited. Applied on top of EXIF auto-orient.
```
This needs a migration. No index needed — `edits` is read/written atomically per photo, never
queried by value.

### 3.2 Shared type + schema (`packages/shared/src/types.ts`, `packages/shared/src/api.ts`)
```ts
// types.ts
export interface PhotoEdits {
  rotate: 0 | 90 | 180 | 270; // clockwise, applied AFTER EXIF auto-orient
  flipH: boolean;             // mirror left-right
  flipV: boolean;             // mirror top-bottom
  // FUTURE: crop?: {...}; brightness?: number; saturation?: number; temperature?: number;
}
```
Add `edits: PhotoEdits | null` to `PhotoDTO`.

```ts
// api.ts
export const photoEditsSchema = z.object({
  rotate: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  flipH: z.boolean(),
  flipV: z.boolean(),
});
export type PhotoEditsInput = z.infer<typeof photoEditsSchema>;

// body for POST /api/photos/[id]/edit — null clears the recipe (reset to original)
export const editPhotoSchema = z.object({ edits: photoEditsSchema.nullable() });
```
Add a constant `NO_EDITS: PhotoEdits = { rotate: 0, flipH: false, flipV: false }` and a pure
helper `hasEdits(e: PhotoEdits | null): boolean` (true when non-null and not equal to `NO_EDITS`).

### 3.3 DTO mapper (`packages/db/src/mappers.ts`)
`toPhotoDTO` maps `row.edits` (Prisma `JsonValue`) to `PhotoEdits | null`. Because the JSON is
unvalidated at the DB layer, parse defensively: if it doesn't match the shape, treat as `null`.
Update `packages/db/src/mappers.test.ts` accordingly.

## 4. Canonical transform (preview === server output)

One fixed application order, implemented identically on client and server so the live CSS
preview is pixel-faithful to the saved rendition:

```
start from EXIF-auto-oriented original
→ flipH (mirror X)
→ flipV (mirror Y)
→ rotate(rotate°) clockwise
```

- **Server (`sharp`):** `.rotate()` (EXIF auto-orient) → `.flop()` if flipH → `.flip()` if flipV
  → `.rotate(rotate)` if rotate. (Note sharp naming: `.flop()` = horizontal, `.flip()` =
  vertical.)
- **Client (CSS):** `transform: scaleX(flipH ? -1 : 1) scaleY(flipV ? -1 : 1) rotate(${rotate}deg)`
  with `transform-origin: center`.

### 4.1 Recipe helpers (pure, unit-tested) — `packages/shared/src/photo-edits.ts`
- `rotateLeft(e)` / `rotateRight(e)`: step `rotate` by ∓90 mod 360.
- `toggleFlipH(e)` / `toggleFlipV(e)`: **axis-aware** so the buttons stay visually intuitive.
  When `rotate` is 90 or 270 the on-screen horizontal axis is the image's vertical axis, so
  "flip horizontal" toggles `flipV` (and vice-versa). The stored recipe stays canonical; the
  live preview always reflects the true result regardless, so this is a UX nicety, not a
  correctness requirement.
- `orientedSize(width, height, e)`: returns `[w, h]` swapped when `rotate` is 90/270. Used to
  predict the post-edit display dimensions for optimistic store patching.
- `hasEdits(e)` as above.

## 5. Shared rendition pipeline (`@lumio/ingest`)

Today `processImage` (`packages/ingest/src/process.ts`) does decode → `.rotate()` → resize.
Factor the rendition-building half into a reusable function so **ingest and editing share one
source of truth** for how renditions are produced.

New (`packages/ingest/src/renditions.ts`):
```ts
export interface Renditions {
  display: Buffer; thumbnail: Buffer; thumbhash: string; width: number; height: number;
}
export async function buildRenditions(
  decodedInput: sharp input, edits: PhotoEdits | null,
): Promise<Renditions>;
```
- Pipeline: `sharp(input).rotate()` (EXIF) → apply edits (flop/flip/rotate per §4) → read
  oriented metadata for width/height → resize `DISPLAY_MAX` → display WebP q80 → thumbnail
  from display buffer (`THUMBNAIL_MAX` WebP q80) → thumbhash from thumbnail.
- `width`/`height` are post-edit oriented dimensions (swap on rotate 90/270).
- A small internal `applyEdits(sharp, edits)` does the flop/flip/rotate; reused by the edited
  download encoder (§7).

Refactor `processImage` to call `buildRenditions(decoded.input, null)` for the metadata-derived
fields, keeping its existing hash/EXIF logic. Behavior for the no-edits path must be unchanged
(existing ingest tests still pass).

## 6. Edit API & service

### 6.1 Route — `apps/web/src/app/api/photos/[id]/edit/route.ts`
`POST` (Node runtime, `force-dynamic`), `withAuth`. Body validated by `editPhotoSchema`.
Calls `applyPhotoEdits(id, edits)`; returns the updated `PhotoDTO` (200) or 404 if missing.

### 6.2 Service — `apps/web/src/lib/photo-edits-service.ts`
`applyPhotoEdits(id, edits: PhotoEdits | null, db = prisma)`:
1. Load the photo; resolve `originalPath(photo.path)`.
2. `decodeToSharpInput(absPath)` (reuses the JXL/HEIC decode path from `@lumio/ingest`).
3. `buildRenditions(decoded.input, edits)` (or `null` to reset).
4. Overwrite the cached files at `displayPath(id)` and `thumbnailPath(id)`.
5. `db.photo.update`: set `edits` (store `null` when `!hasEdits(edits)`), `width`, `height`,
   `thumbhash`. `updatedAt` auto-bumps (Prisma `@updatedAt`) — this is the cache-bust token.
6. Return `toPhotoDTO(updated)`.
7. `decoded.cleanup()` in `finally`.

Reset to original = `applyPhotoEdits(id, null)` → renditions regenerated with no recipe,
`edits` set to `null`.

## 7. Edited full-resolution download

### 7.1 Route — `apps/web/src/app/api/photos/[id]/edited/route.ts`
`GET ?download=1`, `withAuth`, Node runtime. Loads the photo; if `!hasEdits(photo.edits)`
redirect/serve identically to the original (defensive — the client only calls this for edited
photos). Otherwise: `decodeToSharpInput(original)` → `applyEdits` (full-res, **no resize**) →
`.jpeg({ quality: 92 })` → stream. Filename = original basename with extension swapped to
`.jpg`; EXIF preserved minus orientation (orientation baked into pixels). `Content-Disposition`
via `attachmentDisposition`.

### 7.2 Bulk edited zip — extend `apps/web/src/lib/download-service.ts` + `/api/photos/download`
- Request body gains `variant: "original" | "edited"` (default `"original"`); add to the Zod
  schema for that route (currently `photoIdsSchema`). Selection in
  `listPhotosForDownload` also selects `edits` when variant is `edited`.
- `streamPhotosZip(photos, zipName, variant, resolve)`: for `variant === "edited"`, per photo:
  if `hasEdits` → generate the edited JPEG buffer (same encoder as §7.1) and
  `archive.append(buffer, { name })` with `.jpg` extension; else `archive.file(original)` as
  today. `variant === "original"` is unchanged. Dedupe logic is reused unchanged.

## 8. Cache-busting (how saved edits appear everywhere)

Rendition routes keep `Cache-Control: ...immutable`. The **client** appends
`?v={epochMs(updatedAt)}` to every rendition URL so a regenerated rendition is fetched fresh
while each version stays cacheable forever.

Add a tiny helper `apps/web/src/lib/rendition-url.ts`:
```ts
export const thumbUrl = (p: PhotoDTO) => `/api/thumbnails/${p.id}?v=${Date.parse(p.updatedAt)}`;
export const displayUrl = (p: PhotoDTO) => `/api/photos/${p.id}/display?v=${Date.parse(p.updatedAt)}`;
```
Touch points to route through these helpers:
- `apps/web/src/components/photo-grid/photo-thumb.tsx` (`<img src>`).
- `apps/web/src/components/photo-grid/lightbox.tsx` (`LightboxImage` `src`, and the
  `useImageLoaded(src)` / `useBlurBox` keys derived from it).
- `apps/web/src/components/photo-grid/film-strip.tsx` (strip thumbnails).
- `apps/web/src/components/photo-grid/photo-collection.tsx` (display preload for ±2 neighbors).

After Apply, the store is patched with `{ edits, width, height, thumbhash, updatedAt }`
(see §9); the new `updatedAt` changes every rendition URL for that photo and the swapped
width/height re-lays-out its grid tile. (Existing patch consumers: color-label and album
membership already use `patchPhotos`.)

## 9. Edit session & lightbox integration

The Edit tab (controls, in the sidebar) and the center image (preview) both need the working
recipe, and navigation must be gated when there are unsaved edits. Hold this in an **edit
session** owned at the `Lightbox` level (a small context/provider scoped to the open lightbox),
exposed via `useEditSession()`:

```ts
interface EditSession {
  working: PhotoEdits;     // seeded from photo.edits ?? NO_EDITS, re-seeded per photo
  dirty: boolean;          // working differs from saved photo.edits
  applying: boolean;
  set(next: PhotoEdits): void;   // rotate/flip buttons call this
  reset(): void;                 // working = NO_EDITS (preview shows original)
  apply(): Promise<void>;        // POST /edit, patch store, clear dirty
  guardNavigate(go: () => void): void; // prompt-if-dirty wrapper
}
```

- **Preview:** `LightboxImage` applies the §4 CSS transform from `working`. For rotate 90/270
  the layout box must fit the rotated image — constrain using `orientedSize` (scale-to-fit on
  the rotated bounds) so the preview never overflows or clips. (Implementation detail handled
  in the preview layer.)
- **Apply:** calls the edit API, then `gridRef.patchPhotos(new Set([id]), { edits, width,
  height, thumbhash, updatedAt })` from the returned DTO; toast on error, keep working state.
- **Nav guard (decision §2.4):** all lightbox navigation exits route through
  `guardNavigate` so a dirty session prompts "Discard unsaved edits?" before proceeding:
  - prev/next arrows (`NavArrow onClick`),
  - keyboard stepper (`ArrowLeft`/`ArrowRight`) and `Escape`,
  - film-strip `onPick`,
  - backdrop click close.
  Reuse the existing `useConfirm` dialog. On confirm, discard `working` and proceed; on cancel,
  stay. Switching to the next photo re-seeds `working` from that photo's `edits`.

## 10. Edit tab UI (`apps/web/src/components/photo-grid/lightbox-sidebar.tsx` + new component)

- Add a third `TabsTrigger value="edit"` and `TabsContent`. Extract the Edit panel into
  `lightbox-edit-panel.tsx` to keep the sidebar file focused.
- Controls (phase 1): **Rotate left**, **Rotate right**, **Flip horizontal**, **Flip vertical**
  as outline icon buttons (lucide: `RotateCcw`, `RotateCw`, `FlipHorizontal`, `FlipVertical`),
  matching the existing outline-icon-button toolbar style (do **not** modify `ui/*`; copy
  styles per project convention).
- Footer: **Apply** (primary, disabled unless `dirty`, shows `applying` spinner) and **Reset**
  (ghost/outline, disabled unless `working !== NO_EDITS`). A subtle "Unsaved changes" hint when
  dirty.
- Placeholders/affordance for future controls (crop, sliders) are out of scope but the panel
  layout should leave room.

## 11. Split download UI

### 11.1 Component — `apps/web/src/components/photo-actions/download-split-button.tsx`
A button whose primary click runs the edited download and which, on hover/focus, reveals a
small menu ("Download edited" / "Download original"). Built from existing `ui/*` primitives
(e.g. a `DropdownMenu` opened on hover, or a hover-revealed popover) without modifying them.

### 11.2 Client — `apps/web/src/lib/download-client.ts`
`downloadSelection(ids, variant: "original" | "edited" = "original")`:
- single + `edited` → `downloadFromUrl(/api/photos/${id}/edited?download=1)`.
- single + `original` → existing `/original?download=1`.
- many → POST `/api/photos/download` with `{ ids, variant }`; filename
  `lumio-photos-${n}${variant === "edited" ? "-edited" : ""}.zip`.

### 11.3 Actions hook — `apps/web/src/components/photo-actions/use-photo-actions.tsx`
`download(ids, opts?)` gains an optional `variant`; threads it to `downloadSelection`.

### 11.4 Lightbox sidebar
Replace the plain Download `<a>` with: when `hasEdits(photo.edits)` → `DownloadSplitButton`
(primary = edited, menu = edited/original); else → the current plain Download button (original).

### 11.5 Context menu — `apps/web/src/components/photo-grid/photo-context-menu.tsx`
Determine whether **any** target is edited. The menu only has `targetIds`, so add a way to read
the targets' `edits` from the grid store (e.g. a `photosByIds(ids)` selector on the
collection / `PhotoGridHandle`, backed by the page store). Then:
- any edited → two items: "Download N edited" (`download(ids, { variant: "edited" })`) and
  "Download N originals" (`download(ids, { variant: "original" })`).
- none edited → single "Download N photos" (`download(ids)`) — unchanged.
The server zip handles per-photo fallback (unedited photos in an "edited" zip ship original
bytes), so the client only needs the any-edited boolean.

## 12. File-by-file change list

**Schema / shared / db**
- `packages/db/prisma/schema.prisma` — add `edits Json?`; new migration.
- `packages/shared/src/types.ts` — `PhotoEdits`, `PhotoDTO.edits`.
- `packages/shared/src/api.ts` — `photoEditsSchema`, `editPhotoSchema`, download `variant`.
- `packages/shared/src/photo-edits.ts` (new) — `NO_EDITS`, `hasEdits`, rotate/flip/orientedSize. + tests.
- `packages/db/src/mappers.ts` (+ test) — map `edits` defensively.

**Ingest**
- `packages/ingest/src/renditions.ts` (new) — `buildRenditions`, `applyEdits`.
- `packages/ingest/src/process.ts` — refactor onto `buildRenditions`.

**API / services (web)**
- `apps/web/src/app/api/photos/[id]/edit/route.ts` (new).
- `apps/web/src/lib/photo-edits-service.ts` (new) — `applyPhotoEdits`.
- `apps/web/src/app/api/photos/[id]/edited/route.ts` (new) — full-res edited JPEG.
- `apps/web/src/app/api/photos/download/route.ts` — accept `variant`.
- `apps/web/src/lib/download-service.ts` — variant-aware zip.
- `apps/web/src/lib/photos-service.ts` — `listPhotosForDownload` selects `edits`.

**Client / UI (web)**
- `apps/web/src/lib/rendition-url.ts` (new) — versioned URL helpers.
- `apps/web/src/components/photo-grid/photo-thumb.tsx` — versioned thumb URL.
- `apps/web/src/components/photo-grid/film-strip.tsx` — versioned thumb URL.
- `apps/web/src/components/photo-grid/lightbox.tsx` — versioned display URL, edit session,
  preview transform, guarded navigation.
- `apps/web/src/components/photo-grid/photo-collection.tsx` — versioned preload; expose
  `photosByIds`.
- `apps/web/src/components/photo-grid/lightbox-sidebar.tsx` — Edit tab.
- `apps/web/src/components/photo-grid/lightbox-edit-panel.tsx` (new) — edit controls.
- `apps/web/src/components/photo-actions/download-split-button.tsx` (new).
- `apps/web/src/components/photo-actions/use-photo-actions.tsx` — `variant`.
- `apps/web/src/lib/download-client.ts` — `variant`.
- `apps/web/src/components/photo-grid/photo-context-menu.tsx` — adaptive download items.

## 13. Testing

Unit (follow the existing `photo-page-store` / `mappers` / `api` test style):
- `photo-edits.ts`: rotateLeft/Right wrap mod 360; axis-aware flip toggles; `orientedSize`
  swap on 90/270; `hasEdits` (null, NO_EDITS, real edits).
- `mappers.ts`: `edits` mapped through; malformed JSON → `null`.
- `renditions.ts`: dimensions swap on rotate 90/270; flip/rotate composition produces expected
  pixel orientation (small fixture image).
- `download-service.ts`: edited variant emits a generated entry for edited photos and an
  original entry otherwise; dedupe still holds.
- `api.ts`: `editPhotoSchema` accepts valid recipes / null, rejects bad rotate values.

Browser-verify (per dev workflow): rotate/flip live preview matches saved result across grid +
lightbox; cache-bust refreshes thumbnails; Reset; Apply; discard prompt on nav/close; split
download (edited vs original) in lightbox + context menu; bulk edited zip.

## 14. Phasing / out of scope

- **Phase 1 (this spec):** rotate/flip end to end + the full foundation above.
- **Later (same recipe/pipeline/tab):** crop (freeform + ratio presets, selectable area),
  brightness, saturation, temperature. Crop adds a `crop` field + an interactive overlay on the
  preview; sliders add numeric fields + a debounced/Done apply. The adjustment sliders will use
  the explicit-Apply model already established here.
- **Not doing:** edit history/versions; lossless JPEG rotation (re-encode is acceptable);
  preserving the original format on edited download (always JPEG for now); on-disk caching of
  edited downloads (generated on the fly; revisit if hot).

## 15. Assumptions

- Edited JPEG quality = 92 (high; tweakable).
- Edited download preserves non-orientation EXIF; orientation is baked into pixels.
- `updatedAt` is acceptable as the cache-bust token (it changes on unrelated photo updates like
  color-label, harmlessly re-fetching that photo's rendition once — rare, cheap).
