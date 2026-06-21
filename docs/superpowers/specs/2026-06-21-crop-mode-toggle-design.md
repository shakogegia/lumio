# Crop mode toggle — design

**Date:** 2026-06-21
**Status:** Approved for planning
**Scope:** Gate the crop+straighten editor behind an explicit **Crop mode** (enter via a button, exit via Done/Cancel) instead of showing the crop overlay whenever the Edit tab is open. Refinement of `2026-06-21-photo-crop-straighten-design.md`.
**Out of scope:** the recipe, the `sharp` bake, the geometry helpers, and the `/edit-base` endpoint — all unchanged.

## 1. Goal

Today, opening the lightbox **Edit** tab immediately shows the interactive crop overlay on the image. That clutters the common rotate/flip case. Instead: the Edit tab opens in a normal state; a **Crop & Straighten** button enters a focused crop mode; **Done**/**Cancel** exit it. Straighten lives inside crop mode; rotate/flip stay on the normal Edit tab.

## 2. Decisions (from brainstorming)

1. **Apply model (option 2):** **Done** only exits crop mode — the crop/straighten stay in the working recipe (dirty) and are baked by the existing main **Apply**, together with any rotate/flip. There is still ONE bake path.
2. **Cancel** reverts crop+straighten to the snapshot taken on entering crop mode, then exits. Rotate/flip are untouched (they can't change inside crop mode).
3. **Crop mode = crop + straighten only.** Rotate/flip remain on the normal Edit tab.
4. **Pending-crop preview:** after Done, the crop is pending (not yet baked). The normal preview only renders the rotate/flip delta, so it can't show the crop. In that window, show the crop **read-only** (dimmed framing, no handles) so the pending crop is visible before Apply.

## 3. Session state (`apps/web/src/components/photo-grid/use-edit-session.tsx`)

Add to the context:
- `cropMode: boolean` and `enterCropMode()` / `doneCropMode()` / `cancelCropMode()`.
- `enterCropMode()`: set `cropMode = true` and store a `cropSnapshot` = the current working recipe (a ref, for Cancel).
- `doneCropMode()`: set `cropMode = false` (working unchanged).
- `cancelCropMode()`: `pushHistory` a recipe that restores the snapshot's `crop` + `straighten` onto the current working recipe (`{ ...working, crop: snapshot.crop, straighten: snapshot.straighten }`), then set `cropMode = false`. (No-op push if nothing changed.)
- `cropMode` resets to `false` on photo navigation (fold into the existing `reseed` path that already clears `baseSize`).

Keep the existing `editing` flag (Edit tab mounted). `setStraighten`/`setCrop`/`setAspect` are unchanged. The unsaved-changes nav guard still keys off `dirty`, which already includes crop/straighten.

## 4. Center preview (`apps/web/src/components/photo-grid/zoomable-image.tsx`)

Replace the current `editing ? EditorCanvas : <delta block>` with a 3-way choice. Define `pendingGeom` = working differs from the displayed rendition's recipe (`shown.recipe`) in `straighten` or `crop` (reuse `sameEdits`-style comparison on those two fields).

- **`cropMode`** → `EditorCanvas` with `interactive` (edit-base + interactive crop overlay) — the current behavior.
- **else if `editing && pendingGeom`** → `EditorCanvas` with `interactive={false}` (edit-base + read-only crop framing: dim surround + frame + thirds, NO handles, no pointer).
- **else** → the existing baked-rendition + rotate/flip CSS delta + zoom/pan path (restores the snappy pre-crop-feature behavior; no crop overlay).

`EditorCanvas` gains an `interactive` prop, threaded to `CropOverlay`. Its zoom/pan, blur-up, and double-buffer logic for the third state are unchanged.

## 5. Crop overlay (`apps/web/src/components/photo-grid/crop-overlay.tsx`)

Add an `interactive?: boolean` prop (default true). When `false`: render the dim surround, frame border, and rule-of-thirds, but render NO handles and attach no pointer handlers (`onPointerDown`/`Move`/`Up`/`Cancel` omitted), and no `cursor: move`. All geometry/clamp logic is unchanged.

## 6. Edit panel (`apps/web/src/components/photo-grid/lightbox-edit-panel.tsx`)

Branch the panel body on `cropMode`:
- **Normal (not crop mode):** Apply / Reset · **Transform** (rotate/flip) · a **Crop & Straighten** button (`onClick={enterCropMode}`) · Undo/Redo. (Remove the always-on Straighten slider + aspect chips from here.)
- **Crop mode:** **Straighten** slider · **Crop** aspect chips · Undo/Redo · a footer with **Done** (`doneCropMode`) and **Cancel** (`cancelCropMode`).

The panel still mounts/unmounts with the Edit tab (sets `editing`). The `useEditKeyboard` rotate/apply shortcuts stay active in the normal state; they're harmless in crop mode (rotate isn't shown but the shortcut still rotates the working recipe — acceptable, or gate later).

## 7. File-by-file change list
- `use-edit-session.tsx` — `cropMode` + `enterCropMode`/`doneCropMode`/`cancelCropMode` + snapshot ref; reset `cropMode` on nav.
- `crop-overlay.tsx` — `interactive?` prop (hide handles/pointer when false).
- `zoomable-image.tsx` — 3-way canvas choice (`cropMode` / `editing && pendingGeom` / baked+delta); `EditorCanvas` gains `interactive` prop.
- `lightbox-edit-panel.tsx` — normal vs crop-mode bodies; Crop button; Done/Cancel.

## 8. Testing
- No new unit tests required (the recipe/bake/geometry are unchanged and already covered). The session changes (cropMode/enter/done/cancel) are simple state; covered by browser-verify.
- **Browser-verify:** Edit tab opens with no crop overlay (rotate/flip work + zoom). Click Crop & Straighten → overlay + slider + chips appear. Adjust → Done → overlay gone, pending crop shown read-only (dimmed framing). Apply → baked, grid/lightbox reflect it. Re-enter crop, Cancel → crop/straighten revert, rotate/flip preserved. Undo/redo across both modes. Discard-on-nav still prompts when dirty.

## 9. Assumptions / non-goals
- Read-only pending preview uses the same dim framing as the editor (not a scaled "final result" render) — clearly communicates the crop without extra geometry.
- Rotate/flip keyboard shortcuts remain global to the Edit tab; not disabled inside crop mode (low risk).
- No recipe/bake/endpoint changes; the aspect-chip active-highlight gap noted in the prior feature remains a separate follow-up.
