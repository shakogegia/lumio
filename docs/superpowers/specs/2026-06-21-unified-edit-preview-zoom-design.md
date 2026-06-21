# Unified edited preview + zoom — design

**Date:** 2026-06-21
**Status:** Approved for planning
**Scope:** Make the lightbox editor a single WYSIWYG "edited result" preview (working recipe fully applied) with zoom/pan, replacing the baked-rendition+CSS-delta and the read-only dim-framing branches. Crop mode keeps its interactive overlay. Fixes "zoom shows the uncropped original" and "rotate/exit shows a crop overlay".
**Out of scope:** the recipe model, the `sharp` bake, the geometry math (straightenedSize/centeredAspectCrop/etc.), and crop-mode interaction — all unchanged.

## 1. Goal

There should be **one source of truth for the edited image while editing**: the working recipe, rendered live as the actual result (flip → rotate → straighten → crop, and future adjustments). The editor's center always shows this result, except inside Crop mode where the full image + crop overlay is shown so the crop can be adjusted. Zoom/pan works on the edited result, at full resolution.

## 2. Decisions (from brainstorming)

1. **Single live edited preview.** While the Edit tab is open and NOT in crop mode, the center renders the working recipe from the edit-free base, **clipped to the crop region and fit to the viewport** — the WYSIWYG result, no overlays, shown before saving.
2. **Zoom/pan on the edited result**, reusing the existing zoom engine. Crisp deep zoom uses a new **full-resolution edit-free** source.
3. **Crop mode unchanged** — full (uncropped) image + interactive crop overlay; the only place overlays appear.
4. **Remove the read-only dim-framing branch** (the `editing && pendingGeom` arm) — superseded by the clean edited-result render.
5. **Non-editing view** keeps the baked rendition + zoom, but its hi-res zoom source becomes **`/edited`** (full-res baked) for edited photos, never the raw original.

## 3. Full-resolution edit-free source

### 3.1 `buildEditBaseFull` (`packages/ingest/src/renditions.ts`)
```ts
/** Full-resolution, EXIF-oriented, edit-free WebP — the hi-res source the editor
 *  swaps to on zoom (recipe applied via CSS). Like buildEditBase but no resize. */
export async function buildEditBaseFull(input: RenditionInput): Promise<Buffer> {
  return sharp(input).rotate().webp({ quality: 82 }).toBuffer();
}
```
(Test: returns a webp at the natural aspect, larger than the DISPLAY_MAX edit-base for a >2048px fixture.)

### 3.2 Route (`apps/web/src/app/api/photos/[id]/edit-base/route.ts`)
Extend the existing route to honor `?full=1`: when present, return `buildEditBaseFull(decoded.input)`; otherwise the current `buildEditBase`. Same `withAuth`, decode, immutable cache headers, and `cleanup()` in `finally`.

## 4. Shared editor geometry (edit-base → O′ stage)

Both the edited-result render and the crop-mode overlay show the same thing: the edit-base with flip + coarse-rotate + straighten applied, laid out on the **O′ stage** (the straightened bounding box). They differ only in framing:
- **Crop mode:** the O′ stage is *fit whole* into the viewport, with `CropOverlay` on top.
- **Result:** the O′ stage is *scaled and offset so the crop sub-rect fills a clip box*, which is then fit/zoomed in the viewport.

Factor the stage+image markup into one small piece so both modes share it. The "O-box holds the rotated base image" structure already exists in today's `EditorCanvas` — reuse it.

**Result geometry (clip-to-crop), given the clip box's rendered size `(bw, bh)` and the effective crop `c` (O′ fractions):**
- `stageW = bw / c.w`, `stageH = bh / c.h` (so the crop sub-rect is exactly `bw×bh`).
- Place the O′ stage at offset `(-c.x·stageW, -c.y·stageH)` inside the clip box; `overflow: hidden` on the box clips to the crop.
- Inside the stage, the O-box (size from `straightenedSize` of the oriented dims scaled to `stageW/stageH`) carries the base `<img>` with `rotate(working.rotate) scaleX(sx) scaleY(sy)`, and the O-box itself is `rotate(straighten)` — identical to today's crop-mode canvas.
- The clip box's aspect = `(c.w·W′) : (c.h·H′)`; it's sized `object-contain`-style (max-h/max-w + aspect) so it fits the zoom container.

`effectiveCrop` = `working.crop ?? (straighten≠0 ? centeredAspectCrop(...) : full-frame {0,0,1,1})`.

## 5. Zoom/pan integration (`apps/web/src/components/photo-grid/zoomable-image.tsx`)

The zoom engine (`useZoomPan(w, h)`) applies one `translate+scale` transform to a container. The edited-result element is self-contained (its recipe transforms are internal), so wrapping it in the zoom container scales it as a whole — no need to compose zoom with the recipe transforms.

- Feed `useZoomPan` the **result dims** when editing (the working result's `(c.w·W′, c.h·H′)`), and the baked `shown` dims otherwise. (When not editing, working == saved, so they coincide.)
- **Editing, not crop mode:** render the `EditedResult` element inside the existing zoom container (the `inset-4` div that carries `transform`/pan handlers). It fits at zoom=fit and scales on zoom.
- **Hi-res swap:** the `EditedResult`'s base `<img>` uses `/edit-base` (display-res) at fit, and swaps to `/edit-base?full=1` once `isZoomed` (decode-then-swap, mirroring today's original-swap). Recipe is applied via CSS either way.
- **Crop mode:** unchanged — `EditorCanvas` (fit-whole stage + interactive `CropOverlay`), no zoom.
- **Not editing:** the existing baked-rendition path, but the hi-res swap source becomes `hasEdits(photo.edits) ? \`/api/photos/${id}/edited?v=${renditionVersion(photo.updatedAt)}\` : \`/api/photos/${id}/original\``.

Canvas selection becomes: `cropMode ? <CropEditor/> : <EditedResult/>(when editing) : <BakedZoom/>`. Concretely, while `editing` is true use the `EditedResult` zoom path; otherwise the baked path. Remove the `pendingGeom`/`cropSame` framing logic.

## 6. Components

- **`EditedResult`** (new, in `zoomable-image.tsx` or a sibling `edited-result.tsx`): props `{ src, fullSrc, working, orientedBase }`; measures its clip box, computes the §4 result geometry, renders the clipped transformed base; handles the display→full src swap internally on a `zoomed` prop (or reads it). It is placed inside the zoom container so pan/zoom scale it.
- **`EditorCanvas`** (existing, crop mode): keep as-is (fit-whole stage + `CropOverlay`).
- Share the O-box+image markup between the two (small inline helper or a `BaseImageStage` subcomponent) to avoid divergence.

## 7. File-by-file change list
- `packages/ingest/src/renditions.ts` (+ test) — `buildEditBaseFull`.
- `apps/web/src/app/api/photos/[id]/edit-base/route.ts` — `?full=1` branch.
- `apps/web/src/components/photo-grid/zoomable-image.tsx` — feed `useZoomPan` result dims when editing; render `EditedResult` in the zoom container when editing & not crop mode; remove the framing branch + `pendingGeom`; non-editing hi-res → `/edited`; the full-res edit-base swap on zoom.
- `apps/web/src/components/photo-grid/edited-result.tsx` (new, optional split) — the clip-to-crop result render.
- (Possibly extract a `BaseImageStage` shared by `EditedResult` and `EditorCanvas`.)

## 8. Testing
- Unit: `buildEditBaseFull` returns a larger-than-display webp at the natural aspect (ingest test). The clip-to-crop stage math, if extracted to a pure helper, gets a small test (stageW = bw/c.w etc.).
- Browser-verify: open a saved cropped/rotated/straightened photo → Edit tab shows the clean edited result; zoom/pan works and sharpens (full edit-base) on zoom; rotate in the edit view shows the rotated cropped result (no overlay); enter crop mode → full image + overlay; Done → edited result (no overlay) before save; Apply → baked matches; non-editing view zoom shows the edited result (not the uncropped original); HEIC/JXL editor works.

## 9. Assumptions / non-goals
- The edited-result preview is rendered via CSS from the edit-free base (display-res at fit, full-res on zoom); no per-change server bake (instant feedback).
- Full-res edit-base webp assumes images within WebP's 16383px limit (true for the library's photos); revisit with a tiled/JPEG fallback only if that breaks.
- The recipe/bake/`/edited` download path and crop-mode interaction are unchanged.
- Future adjustments (brightness/contrast) slot into the same single edited-preview render via CSS filters, then the bake — no further preview rework needed.
