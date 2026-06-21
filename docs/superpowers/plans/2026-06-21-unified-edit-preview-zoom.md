# Unified Edited Preview + Zoom Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the lightbox editor render one WYSIWYG "edited result" (the working recipe applied, clipped to the crop, fit to view) with zoom/pan, replacing the baked+CSS-delta and dim-framing branches; crop mode keeps its overlay.

**Architecture:** A shared `BaseImageStage` renders the edit-free base with flip/rotate/straighten on an O′ stage. The crop editor fits that stage whole + overlay; the new `EditedResult` scales/offsets the stage so the crop sub-rect fills a clipped box, fit to the viewport, and is wrapped by the existing zoom engine (zoom scales the whole element). A full-res edit-free endpoint feeds crisp zoom.

**Tech Stack:** Next.js App Router, React (React Compiler — `"use client"` line 1; no sync setState in effect bodies), sharp, Tailwind. Reference spec: `docs/superpowers/specs/2026-06-21-unified-edit-preview-zoom-design.md`.

**Verify (web tasks):** `pnpm --filter @lumio/web lint` — no new errors in touched files. Known pre-existing lint errors to ignore: `use-activity.ts`, `use-async-job.ts`, `library-tree.tsx`/`use-rename-folder-dialog.tsx`, `add-to-album-dialog.tsx`. Browser-verify is a final pass (don't run the dev server in tasks).

---

## Task 1: Full-resolution edit-free source

**Files:**
- Modify: `packages/ingest/src/renditions.ts`
- Test: `packages/ingest/src/renditions.test.ts`
- Modify: `apps/web/src/app/api/photos/[id]/edit-base/route.ts`

- [ ] **Step 1: Failing test**
Append to `packages/ingest/src/renditions.test.ts` (add `buildEditBaseFull` to the import from `./renditions.js`):
```ts
describe("buildEditBaseFull", () => {
  it("returns a full-resolution EXIF-oriented WebP (no DISPLAY_MAX downscale)", async () => {
    const img = await sharp({
      create: { width: 3000, height: 2000, channels: 3, background: { r: 4, g: 5, b: 6 } },
    }).png().toBuffer();
    const out = await buildEditBaseFull(img);
    const meta = await sharp(out).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.width).toBe(3000); // not clamped to 2048 like buildEditBase
    expect(meta.height).toBe(2000);
  });
});
```

- [ ] **Step 2: Run → FAIL** (`buildEditBaseFull` not exported). `pnpm --filter @lumio/ingest test renditions`.

- [ ] **Step 3: Implement** — append to `packages/ingest/src/renditions.ts`:
```ts
/** Full-resolution, EXIF-oriented, EDIT-FREE WebP — the hi-res source the editor
 *  swaps to on zoom (the working recipe is applied via CSS). Like buildEditBase
 *  but without the DISPLAY_MAX downscale. */
export async function buildEditBaseFull(input: RenditionInput): Promise<Buffer> {
  return sharp(input).rotate().webp({ quality: 82 }).toBuffer();
}
```

- [ ] **Step 4: Run → PASS.** Then `pnpm --filter @lumio/ingest test` all green.

- [ ] **Step 5: Route `?full=1`** — in `apps/web/src/app/api/photos/[id]/edit-base/route.ts`, import `buildEditBaseFull` alongside `buildEditBase`, and branch on the query param. Replace the `const webp = await buildEditBase(decoded.input);` line with:
```ts
      const full = new URL(_request.url).searchParams.get("full");
      const webp = full
        ? await buildEditBaseFull(decoded.input)
        : await buildEditBase(decoded.input);
```
(The handler's first arg is currently named `_request`; rename it to `request` and use `request.url`. Keep everything else — `withAuth`, decode, immutable `Cache-Control`, `cleanup()` in `finally`.)

- [ ] **Step 6: Verify** `pnpm --filter @lumio/web lint` (route file clean).

- [ ] **Step 7: Commit**
```bash
git add packages/ingest/src/renditions.ts packages/ingest/src/renditions.test.ts "apps/web/src/app/api/photos/[id]/edit-base/route.ts"
git commit -m "feat: full-resolution edit-free source for editor zoom"
```

---

## Task 2: Shared `BaseImageStage` + refactor `EditorCanvas`

**Files:**
- Create: `apps/web/src/components/photo-grid/base-image-stage.tsx`
- Modify: `apps/web/src/components/photo-grid/zoomable-image.tsx` (EditorCanvas uses it)

- [ ] **Step 1: Create `base-image-stage.tsx`**
```tsx
"use client";

import { straightenedSize, type PhotoEdits } from "@lumio/shared";

/** Renders the edit-free base with flip + coarse-rotate + straighten applied, as
 *  the O-box (the oriented image, tilted by straighten) holding the base <img>.
 *  Caller wraps this in a POSITIONED stage box of pixel size stageW×stageH (the
 *  O′ straightened bounding box); this fills that box. Shared by the crop editor
 *  (stage fit whole + overlay) and the edited-result preview (stage clipped to
 *  the crop). `orientedBase` is the oriented image dims (aspect only matters). */
export function BaseImageStage({
  src,
  stageW,
  stageH,
  orientedBase,
  working,
  onLoad,
}: {
  src: string;
  stageW: number;
  stageH: number;
  orientedBase: { w: number; h: number };
  working: PhotoEdits;
  onLoad?: (e: React.SyntheticEvent<HTMLImageElement>) => void;
}) {
  const theta = working.straighten ?? 0;
  const sx = working.flipH ? -1 : 1;
  const sy = working.flipV ? -1 : 1;
  const { w: wp } = straightenedSize(orientedBase.w, orientedBase.h, theta);
  const k = wp === 0 ? 0 : stageW / wp; // uniform O′-unit → px (stageW/wp === stageH/hp)
  const oW = orientedBase.w * k;
  const oH = orientedBase.h * k;
  const swap = working.rotate === 90 || working.rotate === 270;
  return (
    <div
      className="absolute left-1/2 top-1/2"
      style={{ width: oW, height: oH, transform: `translate(-50%, -50%) rotate(${theta}deg)` }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        draggable={false}
        onLoad={onLoad}
        className="absolute left-1/2 top-1/2 max-w-none select-none"
        style={{
          width: swap ? oH : oW,
          height: swap ? oW : oH,
          transform: `translate(-50%, -50%) rotate(${working.rotate}deg) scaleX(${sx}) scaleY(${sy})`,
          transformOrigin: "center center",
        }}
      />
    </div>
  );
}
```
Note: the O-box uses `left-1/2 top-1/2` so the wrapping stage box MUST be `position: relative`/`absolute` of size stageW×stageH.

- [ ] **Step 2: Refactor `EditorCanvas` (in `zoomable-image.tsx`) to use it**
Add `import { BaseImageStage } from "./base-image-stage";`. In `EditorCanvas`'s returned JSX, the O-box `<div className="absolute left-1/2 top-1/2" …>…<img …/></div>` currently lives inside the stage div `<div className="absolute" style={{ width: layout.stageW, height: layout.stageH }}>`. Replace that inner O-box `<div>` (and its `<img>`) with:
```tsx
          <BaseImageStage
            src={src}
            stageW={layout.stageW}
            stageH={layout.stageH}
            orientedBase={orientedBase!}
            working={working}
            onLoad={(e) =>
              onBaseSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
            }
          />
```
Keep the stage `<div className="absolute" style={{ width: layout.stageW, height: layout.stageH }}>` wrapper, the `<CropOverlay …/>`, and the `!orientedBase` hidden-img fallback exactly as they are. Remove the now-unused `sx`/`sy`/local O-box markup from `EditorCanvas` (the stage `theta` rotate is now inside BaseImageStage — so the O-box wrapper that applied `rotate(${theta})` is replaced by BaseImageStage which applies it internally). The `layout` computation (k0/oW/oH/imgW/imgH) stays for stageW/stageH; `imgW`/`imgH`/`oW`/`oH` are no longer needed for markup — keep only `stageW`/`stageH` in `layout` (drop `oW/oH/imgW/imgH` from the layout object and the swap line).

- [ ] **Step 3: Verify** `pnpm --filter @lumio/web lint` (both files clean). Confirm `EditorCanvas` still computes `layout.stageW/stageH` and renders BaseImageStage + CropOverlay; the crop editor must look/behave identically (browser-verify deferred).

- [ ] **Step 4: Commit**
```bash
git add apps/web/src/components/photo-grid/base-image-stage.tsx apps/web/src/components/photo-grid/zoomable-image.tsx
git commit -m "refactor(web): extract BaseImageStage shared by the crop editor"
```

---

## Task 3: `EditedResult` — clip-to-crop WYSIWYG render

**Files:**
- Create: `apps/web/src/components/photo-grid/edited-result.tsx`

- [ ] **Step 1: Create `edited-result.tsx`**
```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { centeredAspectCrop, straightenedSize, type CropRect, type PhotoEdits } from "@lumio/shared";
import { BaseImageStage } from "./base-image-stage";

/** WYSIWYG render of the working recipe: the edit-free base with flip/rotate/
 *  straighten applied, CLIPPED to the crop region and fit to this element's box.
 *  Self-contained — placed inside the zoom container so pan/zoom scale it whole.
 *  Swaps to the full-res base once `zoomed`. */
export function EditedResult({
  src,
  fullSrc,
  zoomed,
  working,
  orientedBase,
  onBaseSize,
}: {
  src: string;
  fullSrc: string;
  zoomed: boolean;
  working: PhotoEdits;
  orientedBase: { w: number; h: number } | null;
  onBaseSize: (s: { w: number; h: number }) => void;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const apply = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Once zoomed, decode the full-res base then swap it in (crisp deep zoom).
  const [hiRes, setHiRes] = useState(false);
  useEffect(() => {
    if (!zoomed || hiRes) return;
    let cancelled = false;
    const img = new Image();
    img.src = fullSrc;
    img.decode().then(() => { if (!cancelled) setHiRes(true); }).catch(() => {});
    return () => { cancelled = true; };
  }, [zoomed, hiRes, fullSrc]);
  const imgSrc = hiRes ? fullSrc : src;

  const theta = working.straighten ?? 0;
  const effectiveCrop: CropRect = orientedBase
    ? working.crop ??
      (theta !== 0
        ? centeredAspectCrop(orientedBase.w / orientedBase.h, orientedBase.w, orientedBase.h, theta)
        : { x: 0, y: 0, w: 1, h: 1 })
    : { x: 0, y: 0, w: 1, h: 1 };

  let inner: React.ReactNode = null;
  if (orientedBase && box.w > 0 && box.h > 0) {
    const { w: wp, h: hp } = straightenedSize(orientedBase.w, orientedBase.h, theta);
    const cropAspect = (effectiveCrop.w * wp) / (effectiveCrop.h * hp);
    // Fit the cropped result (cropAspect) inside the available box.
    let bw = box.w;
    let bh = box.w / cropAspect;
    if (bh > box.h) {
      bh = box.h;
      bw = box.h * cropAspect;
    }
    const stageW = bw / effectiveCrop.w;
    const stageH = bh / effectiveCrop.h;
    inner = (
      <div className="relative overflow-hidden" style={{ width: bw, height: bh }}>
        <div
          className="absolute"
          style={{
            width: stageW,
            height: stageH,
            left: -effectiveCrop.x * stageW,
            top: -effectiveCrop.y * stageH,
          }}
        >
          <BaseImageStage
            src={imgSrc}
            stageW={stageW}
            stageH={stageH}
            orientedBase={orientedBase}
            working={working}
            onLoad={(e) =>
              onBaseSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })
            }
          />
        </div>
      </div>
    );
  }

  return (
    <div ref={boxRef} className="relative flex h-full w-full items-center justify-center overflow-hidden">
      {inner}
      {/* Before the base natural size is known, load it hidden to report it. */}
      {!orientedBase && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={src}
          alt=""
          className="absolute opacity-0 pointer-events-none"
          onLoad={(e) => onBaseSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify** `pnpm --filter @lumio/web lint` (file clean; types resolve).

- [ ] **Step 3: Commit**
```bash
git add apps/web/src/components/photo-grid/edited-result.tsx
git commit -m "feat(web): EditedResult — clipped WYSIWYG render of the working recipe"
```

---

## Task 4: Wire the editor preview + zoom into `zoomable-image`

**Files:**
- Modify: `apps/web/src/components/photo-grid/zoomable-image.tsx`

- [ ] **Step 1: Imports + session + sources**
Add to the `@lumio/shared` import: `hasEdits`. Add `import { displayUrl, renditionVersion } from "@/lib/rendition-url";` (extend the existing `displayUrl` import). Add `import { EditedResult } from "./edited-result";`. Pull `orientedBase` from the session: change the destructure to `const { working, editing, cropMode, orientedBase, setBaseSize } = useEditSession();`. Add the source URLs near the existing `editBaseSrc`:
```ts
  const editBaseFullSrc = `/api/photos/${photo.id}/edit-base?full=1`;
  const hiResSrc = hasEdits(photo.edits)
    ? `/api/photos/${photo.id}/edited?v=${renditionVersion(photo.updatedAt)}`
    : originalSrc;
```

- [ ] **Step 2: Remove the framing logic**
Delete the `wc`/`sc`/`cropSame`/`pendingGeom` block (the lines computing them). It's no longer used.

- [ ] **Step 3: Editor result dims for the zoom engine**
After `orientedBase` is available and before `useZoomPan`, compute the dims to feed the engine — the working result's pixel dims when editing, else the baked `shown` (delta-rotated) dims:
```ts
  const editResultDims =
    editing && orientedBase
      ? (() => {
          const theta = working.straighten ?? 0;
          const { w: wp, h: hp } = straightenedSize(orientedBase.w, orientedBase.h, theta);
          const crop =
            working.crop ??
            (theta !== 0
              ? centeredAspectCrop(orientedBase.w / orientedBase.h, orientedBase.w, orientedBase.h, theta)
              : { x: 0, y: 0, w: 1, h: 1 });
          return [crop.w * wp, crop.h * hp] as const;
        })()
      : null;
  const viewW = editResultDims ? editResultDims[0] : rotated ? shown.h : shown.w;
  const viewH = editResultDims ? editResultDims[1] : rotated ? shown.w : shown.h;
```
(`straightenedSize` and `centeredAspectCrop` are already imported in this file.) Then ensure `useZoomPan(viewW, viewH)` is called with these (it currently receives `viewW, viewH` already — keep that call, it now uses the new values).

- [ ] **Step 4: Non-editing hi-res → `/edited`**
In the hi-res preload effect and the `src` selection (currently using `originalSrc`), use `hiResSrc`. Replace `img.src = originalSrc;` with `img.src = hiResSrc;`, the effect dep `[isZoomed, hiRes, originalSrc]` with `[isZoomed, hiRes, hiResSrc]`, and `const src = isZoomed && hiRes ? originalSrc : shown.src;` with `const src = isZoomed && hiRes ? hiResSrc : shown.src;`. (Keep `originalSrc` defined — `hiResSrc` falls back to it.)

- [ ] **Step 5: Render the editor result inside the zoom container**
The viewport currently renders `{cropMode ? <EditorCanvas …/> : editing && pendingGeom ? <EditorCanvas interactive={false}/> : <div ref={containerRef}>…baked…</div>}`. Replace that whole conditional with:
```tsx
        {cropMode ? (
          <EditorCanvas src={editBaseSrc} onBaseSize={setBaseSize} interactive />
        ) : (
          <div
            ref={containerRef}
            className="absolute inset-4 flex items-center justify-center"
            style={{ transform, transformOrigin: "center", cursor }}
            onPointerDown={handlers.onPointerDown}
            onPointerMove={handlers.onPointerMove}
            onPointerUp={handlers.onPointerUp}
            onPointerCancel={handlers.onPointerCancel}
            onDoubleClick={handlers.onDoubleClick}
          >
            {editing ? (
              <EditedResult
                src={editBaseSrc}
                fullSrc={editBaseFullSrc}
                zoomed={isZoomed}
                working={working}
                orientedBase={orientedBase}
                onBaseSize={setBaseSize}
              />
            ) : (
              <>
                {/* eslint-disable @next/next/no-img-element */}
                {blurUrl && blurBox && (
                  <img
                    src={blurUrl}
                    alt=""
                    aria-hidden
                    className="pointer-events-none absolute object-cover transition-opacity duration-500"
                    style={{
                      left: blurBox.left,
                      top: blurBox.top,
                      width: blurBox.width,
                      height: blurBox.height,
                      opacity: everLoaded ? 0 : 1,
                      zIndex: 1,
                    }}
                  />
                )}
                <img
                  ref={setImg}
                  src={src}
                  alt={photo.path}
                  width={shown.w}
                  height={shown.h}
                  onLoad={onLoad}
                  draggable={false}
                  className="max-h-[80vh] w-full select-none object-contain lg:max-h-full lg:w-auto lg:max-w-full"
                  style={{ transform: editTransform, transformOrigin: "center center", transition: "none" }}
                />
                {/* eslint-enable @next/next/no-img-element */}
              </>
            )}
          </div>
        )}
```
(This keeps the baked `<img>` block verbatim in the `!editing` branch; the only change is wrapping it so `editing` swaps in `EditedResult`. The pan handlers/transform live on the shared container, so zoom/pan work for both the baked image and the edited result.)

- [ ] **Step 6: Verify** `pnpm --filter @lumio/web lint` → no new errors in `zoomable-image.tsx`. Confirm: no references remain to `pendingGeom`; `editing`/`orientedBase`/`hiResSrc`/`editBaseFullSrc` are all used; the `EditorCanvas` `interactive` prop is still passed (`true`).

- [ ] **Step 7: Commit**
```bash
git add apps/web/src/components/photo-grid/zoomable-image.tsx
git commit -m "feat(web): single edited-result preview with zoom; drop dim-framing branch"
```

---

## Task 5: Verification + finish

**Files:** none.

- [ ] **Step 1: Sweep** `pnpm -r test` (all green) and `pnpm --filter @lumio/web lint` (only the known pre-existing errors).

- [ ] **Step 2: Browser-verify** (against the running dev server):
  - Saved cropped/rotated/straightened photo → Edit tab shows the clean edited result (cropped portion, correct orientation), no overlay.
  - Zoom/pan in the edit view works and sharpens on zoom (full-res edit-base); double-click toggles 100%.
  - Rotate in the edit view → rotated cropped result, no overlay popping in.
  - Enter crop mode → full image + interactive overlay; Done → edited result (no overlay) before save; Apply → baked matches the preview.
  - Non-editing view zoom shows the edited (cropped) image, not the uncropped original.
  - HEIC/JXL photo edits + zoom render correctly.

- [ ] **Step 3: Finish** — use superpowers:finishing-a-development-branch.

---

## Self-review (coverage)
- Spec §3 (full-res source) → Task 1. §4 (shared geometry / clip-to-crop) → Tasks 2–3. §5 (zoom integration, non-editing `/edited`, remove framing) → Task 4. §6 (components: BaseImageStage/EditedResult/EditorCanvas) → Tasks 2–4. §8 (testing) → Tasks 1 + 5.
- Type consistency: `buildEditBaseFull` (T1) ; `BaseImageStage` props (T2) consumed by EditorCanvas (T2) + EditedResult (T3); `EditedResult` props (T3) consumed in zoomable-image (T4); `editResultDims`/`hiResSrc`/`editBaseFullSrc` local to T4.
- No placeholders; complete code per step.
- Known limitation: deep zoom on UNSAVED edits uses the full-res edit-free base + CSS recipe (crisp); the result is not re-baked server-side per change (instant feedback) — per spec §9.
