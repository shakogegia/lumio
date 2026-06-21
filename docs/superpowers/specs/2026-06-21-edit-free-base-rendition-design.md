# Edit-free base rendition + separate edited rendition — design

**Date:** 2026-06-21
**Status:** Approved for planning (user pre-approved spec → plan → execute)
**Scope:** Stop overwriting the display rendition on Apply. Keep the display rendition as a permanent **edit-free base** (`original.webp`), write a **separate `edited.webp`** when a photo has edits, and have the editor read the static base instead of decoding the original. Retire the on-demand `/edit-base` endpoint. Goal: **Edit-tab open is a static file read — no JXL/HEIC re-decode**, which matters on the target mini-PC where decoding takes seconds.
**Builds on / amends:** the unified edited-preview feature (`2026-06-21-unified-edit-preview-zoom-design.md`) on the same branch — this retires `/edit-base` and rewires the editor's image sources.

## 1. Goal

Today, **Apply overwrites the display + thumbnail renditions with the baked edit**, so the display rendition is no longer edit-free. To give the editor an edit-free image, the unified-preview work added `/edit-base`, which **decodes the original on demand** — slow for JXL/HEIC on a mini-PC, and the editor canvas waits on it (blank for seconds).

New model (per photo):
- **`original.<ext>`** — the upload; full-res source of truth, untouched.
- **`original.webp`** (the existing display rendition path) — **edit-free**, EXIF-oriented, display-res (≤`DISPLAY_MAX`) WebP. Produced at ingest; **never overwritten**. Serves the **editor canvas** (static read, no decode) and the display view when the photo is unedited.
- **`edited.webp`** (new) — the baked recipe at display-res; written on **Apply**; the display view when the photo is edited.
- **`thumb.webp`** (the existing thumbnail path) — **always current** (edit-free or baked), regenerated on Apply; powers the grid + thumbhash blur. Single file (unchanged behavior).

Net: the only decodes are **once at upload (ingest)**, **on Apply (bake `edited.webp`)**, and **on deliberate full-res zoom/download**. Edit-tab open never decodes.

## 2. Decisions / optimizations (chosen)

1. **Display rendition = permanent edit-free base.** Apply no longer touches it; it writes `edited.webp` instead.
2. **Thumbnail stays a single always-current file** (regenerated on Apply), since it's view-only and never an editor source.
3. **Retire `/edit-base` entirely** (both display-res and `?full=1`), and remove `buildEditBase` + `buildEditBaseFull`. The editor canvas reads the base display file; crisp editor zoom reuses `/original`.
4. **Editor crisp zoom uses `/original`** (decode-then-swap, like the pre-existing zoom). For browser-renderable originals (JPEG/PNG/WebP) it sharpens; for **JXL/HEIC it can't decode in-browser, so it stays at the 2048 base (soft)** — matching what the normal lightbox already does for JXL today. No on-demand transcode. (Crisp JXL editor zoom is an explicit non-goal; re-add an on-demand transcode later if wanted.)
5. **`edited.webp` is display-res and static** (cached), so the non-editing view of an edited photo is cheap; the full-res edited image (`/edited`) stays on-demand for download/non-editing zoom only.

## 3. Storage / paths (`apps/web/src/lib/paths.ts`)

- Keep `displayPath(id)` = the edit-free base (`original.webp`) and `thumbnailPath(id)` = the current thumb (unchanged path semantics; only *when they're written* changes).
- Add `editedDisplayPath(id)` — parallel to `displayPath` (e.g. an `edited/` sibling dir or `{id}.edited.webp`), holding `edited.webp`.

## 4. Renditions (`packages/ingest/src/renditions.ts`)

- **Remove** `buildEditBase` and `buildEditBaseFull` (only the retired `/edit-base` route used them) and their tests.
- Keep `buildRenditions(input, edits)` (returns `{ display, thumbnail, thumbhash, width, height }`). It already bakes whatever recipe it's given:
  - **Ingest** calls it with `null` → produces the **base** display + base thumb (edit-free). Unchanged.
  - **Apply** calls it with `edits` → produces the **edited** display + edited thumb + edited dims.
- `applyStraightenCrop`/`encodeEditedJpeg` unchanged.

## 5. Apply service (`apps/web/src/lib/photo-edits-service.ts`)

`applyPhotoEdits(id, edits)`:
- Decode original once; `buildRenditions(input, edits)`.
- **When `hasEdits(edits)`:** write the baked display to `editedDisplayPath(id)` (NOT `displayPath`), write the baked thumb to `thumbnailPath(id)`, and update `edits`/`width`/`height`/`thumbhash`. **Leave `displayPath` (base) untouched.**
- **When `!hasEdits` (reset to original):** regenerate the base thumb via `buildRenditions(input, null).thumbnail` → `thumbnailPath(id)`; **delete `editedDisplayPath(id)`** (best-effort); set `edits=null` and `width`/`height`/`thumbhash` to the base values. Leave `displayPath` untouched.

`width`/`height`/`thumbhash` continue to reflect the **current** (edited) state — grid layout + blur use the thumbnail, which is always current, so this stays consistent.

## 6. Routes

- **`GET /api/photos/[id]/display`** — serve the base `displayPath` (static, `immutable`). Add support for `?edited=1` → serve `editedDisplayPath` (also `immutable`; the client busts it with `?v=updatedAt`). If `?edited=1` but the edited file is missing, fall back to the base.
- **Delete `GET /api/photos/[id]/edit-base`** (route file removed).
- `GET /api/photos/[id]/edited` (full-res baked JPEG, on-demand) — **unchanged** (download + non-editing zoom of edited photos).
- `GET /api/photos/[id]/original` (raw bytes) — **unchanged** (download original + editor crisp zoom).

## 7. URL helpers (`apps/web/src/lib/rendition-url.ts`)

- `displayUrl(photo)` → `hasEdits(photo.edits) ? \`/api/photos/${id}/display?edited=1&v=${renditionVersion(updatedAt)}\` : \`/api/photos/${id}/display\``. (Base needs no `?v` — it never changes.)
- Add `baseDisplayUrl(photo)` → `\`/api/photos/${id}/display\`` — the edit-free base for the editor canvas.
- `thumbUrl` — unchanged (always current thumb, `?v` busted).

## 8. Editor wiring (`apps/web/src/components/photo-grid/zoomable-image.tsx`, `edited-result.tsx`)

- Editor canvas source (crop mode + `EditedResult`) = `baseDisplayUrl(photo)` (the static base) instead of `editBaseSrc`.
- `EditedResult` `fullSrc` = `/api/photos/${id}/original` (crisp zoom; decode-then-swap already `.catch()`es failures → JXL stays soft at the base). Remove `editBaseSrc`/`editBaseFullSrc`.
- Non-editing view: `shown`/`displaySrc` = `displayUrl(photo)` (edited-or-base); non-editing hi-res zoom `hiResSrc` = `hasEdits ? /edited?v : /original` (unchanged from the unified-preview work).
- `EditorCanvas` (crop mode) `src` = base display URL too.

## 9. Worker re-ingest / regenerate (`packages/ingest` regenerate path + `apps/worker`)

The edits-safe regenerate must produce the new layout from the original:
- Always write the **base** display + (if unedited) base thumb: `buildRenditions(input, null)` → `displayPath` (+ `thumbnailPath` when unedited).
- **If `hasEdits`:** also `buildRenditions(input, edits)` → `editedDisplayPath` + `thumbnailPath` (edited thumb) + dims/thumbhash.
- This keeps `displayPath` edit-free and regenerates `edited.webp` for edited photos.

## 10. Migration (existing edited photos)

Photos edited **before** this change have `displayPath` = the *baked* image (old overwrite behavior), so it is no longer a valid edit-free base — the editor would double-apply the recipe. These must be regenerated once: running the worker rescan/regenerate (which now produces the base + edited split, §9) fixes them. Document this as a **one-time rescan required for previously-edited photos**; do **not** auto-run a destructive backfill (shared-DB safety). New photos and freshly-edited photos are correct without migration.

## 11. File-by-file change list
- `apps/web/src/lib/paths.ts` — add `editedDisplayPath`.
- `packages/ingest/src/renditions.ts` (+ test) — remove `buildEditBase`/`buildEditBaseFull` (+ their tests).
- `apps/web/src/lib/photo-edits-service.ts` (+ test if present) — write `edited.webp`/thumb, never `displayPath`; reset deletes `edited.webp`.
- `apps/web/src/app/api/photos/[id]/display/route.ts` — `?edited=1` branch + fallback.
- `apps/web/src/app/api/photos/[id]/edit-base/route.ts` — **delete**.
- `apps/web/src/lib/rendition-url.ts` — `displayUrl` edited-or-base; add `baseDisplayUrl`.
- `apps/web/src/components/photo-grid/zoomable-image.tsx` — editor canvas src = base; `EditedResult.fullSrc` = `/original`; drop edit-base srcs.
- `apps/web/src/components/photo-grid/edited-result.tsx` — (only its `fullSrc` source changes via the caller; no internal change beyond that).
- Worker regenerate path (`packages/ingest/src/regenerate.ts` or equivalent) (+ test) — base + edited split.

## 12. Testing
- Unit: `applyPhotoEdits` writes `editedDisplayPath` and leaves `displayPath` byte-unchanged (edited case); reset deletes `editedDisplayPath` and regenerates the base thumb. Regenerate produces base (edit-free) + edited for an edited photo. `displayUrl` returns the `?edited=1` URL only when edited. Removing `buildEditBase*` doesn't break ingest.
- Browser-verify (mini-PC focus): open Edit on an unedited JXL → instant (static base, no decode); apply a crop → grid/lightbox show `edited.webp`, editor still reads the base (re-edit instant); reset → back to base; zoom in editor sharpens for JPEG, stays soft for JXL; non-editing zoom of an edited photo shows the edited image. Run the rescan once, confirm a previously-rotated photo edits correctly (no double-apply).

## 13. Non-goals
- Crisp full-res zoom of **JXL/HEIC** inside the editor (stays soft at 2048; re-add an on-demand transcode later if needed).
- Persisting a full-resolution edited or edit-free file (full-res stays on-demand via `/edited` / `/original`).
- Auto-migrating previously-edited photos (a manual rescan handles it).
