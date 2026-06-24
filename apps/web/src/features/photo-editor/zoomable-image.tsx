"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  NO_EDITS,
  hasEdits,
  previewTransform,
  straightenedSize,
  centeredAspectCrop,
  type PhotoDTO,
  type PhotoEdits,
} from "@lumio/shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { thumbhashDataUrl } from "@/lib/thumbhash-url";
import { useImageLoaded } from "@/lib/hooks/use-image-loaded";
import { baseDisplayUrl, displayUrl, renditionVersion } from "@/lib/rendition-url";
import { catalogApiUrl } from "@/lib/catalog-api";
import { useCatalog } from "@/components/providers/catalog-context";
import { MAX_ZOOM } from "./zoom-math";
import { useBlurBox } from "./use-blur-box";
import { useZoomPan } from "./use-zoom-pan";
import { useEditSession } from "./use-edit-session";
import { CropOverlay } from "./crop-overlay";
import { BaseImageStage } from "./base-image-stage";
import { EditedResult } from "./edited-result";

/** Zoom state the stage hands up to whoever renders the lightbox header, so the
 *  header (with its zoom controls) lives in the lightbox layer without the editor
 *  importing it — keeping the editor free of any lightbox dependency. */
export interface ZoomHeaderProps {
  zoom: number;
  min: number;
  onZoom: (zoom: number) => void;
  onStepIn: () => void;
  onStepOut: () => void;
  canStepIn: boolean;
  canStepOut: boolean;
}

export function ZoomableImage({
  photo,
  hasPrev,
  hasNext,
  step,
  renderHeader,
}: {
  photo: PhotoDTO;
  hasPrev: boolean;
  hasNext: boolean;
  step: (delta: 1 | -1) => void;
  /** Renders the header above the stage from the stage's live zoom state. Injected
   *  by the lightbox so the editor never imports lightbox chrome. */
  renderHeader: (zoomHeader: ZoomHeaderProps) => ReactNode;
}) {
  const { slug } = useCatalog();
  const { working, editing, cropMode, orientedBase, setBaseSize } = useEditSession();
  const savedRecipe = photo.edits ?? NO_EDITS;

  const displaySrc = displayUrl(slug, photo);
  const originalSrc = catalogApiUrl(slug, `/photos/${photo.id}/original`);
  const baseSrc = baseDisplayUrl(slug, photo);
  const hiResSrc = hasEdits(photo.edits)
    ? catalogApiUrl(slug, `/photos/${photo.id}/edited?v=${renditionVersion(photo.updatedAt)}`)
    : originalSrc;

  // Double-buffer the display rendition: when an Apply changes the rendition
  // (same photo, new ?v=), keep showing the current one — transformed by the
  // delta — until the new one has preloaded, then swap. Avoids a flash of the
  // blur placeholder or the pre-edit orientation. (`key={photo.id}` in the
  // lightbox remounts this component per photo, so this only fires on Apply.)
  //
  // `shown` carries the displayed rendition's recipe AND its pixel dimensions, so
  // all on-screen geometry follows the rendition actually painted — not `photo`.
  // On Apply, `photo` flips to the new (e.g. rotated → portrait) dimensions at
  // once, while this buffer still shows the old (landscape) rendition; deriving
  // geometry from `photo` would mis-scale that held image and feed the zoom/pan
  // engine the wrong orientation until the swap lands.
  const [shown, setShown] = useState<{
    src: string;
    recipe: PhotoEdits;
    w: number;
    h: number;
  }>({
    src: displaySrc,
    recipe: savedRecipe,
    w: photo.width,
    h: photo.height,
  });
  useEffect(() => {
    if (shown.src === displaySrc) return;
    let cancelled = false;
    const advance = () => {
      if (!cancelled)
        setShown({
          src: displaySrc,
          recipe: savedRecipe,
          w: photo.width,
          h: photo.height,
        });
    };
    // Decode (not merely load) the new rendition before swapping. The live <img>
    // keeps painting the OLD rendition until the new bitmap is decode-ready, and
    // the same commit that swaps the src also drops the edit-delta transform to
    // identity. If we advanced on `onload` (loaded, not yet decoded), that commit
    // could show the old pixels under the new transform for a frame — e.g. the
    // pre-rotation landscape flashing before the baked portrait appears. Decoding
    // first makes the swap seamless (same trick as the zoom→original swap below).
    const img = new Image();
    img.src = displaySrc;
    img.decode().then(advance).catch(advance);
    return () => {
      cancelled = true;
    };
    // savedRecipe and the dimensions are captured intentionally with displaySrc
    // (they all change together on Apply).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displaySrc, shown.src]);

  // Live edit preview = delta from the DISPLAYED rendition's recipe to `working`.
  // Edits snap into place — no transition (no animation in the editor).
  const t = previewTransform(shown.recipe, working);
  const rotated = t.deg === 90 || t.deg === 270;

  // Feed the zoom/pan engine the *previewed* dimensions. When editing, use the
  // EditedResult's actual output size (straightened + cropped). Otherwise use the
  // shown rendition's dimensions with the delta rotation applied (a 90/270 delta
  // swaps width and height). See the double-buffer note above.
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

  const { containerRef, setImgEl, blurBox } = useBlurBox(
    photo.width,
    photo.height,
    photo.id,
  );
  const {
    viewportRef,
    viewport,
    zoom,
    fitZoom,
    isZoomed,
    transform,
    cursor,
    setZoom,
    stepIn,
    stepOut,
    handlers,
    reset: resetZoom,
  } = useZoomPan(viewW, viewH, !cropMode);

  // Toggling edit/crop mode swaps the content (baked → edited-result, or in/out of
  // crop), changing its dimensions. A persisted zoom would be stale/mis-scaled
  // afterward, so reset back to fit whenever the view mode changes. The ref guard
  // makes resetZoom() an indirection that only fires on a real mode change (same
  // pattern as `latch`/`advance`), not a direct setState in the effect body.
  const viewModeRef = useRef({ editing, cropMode });
  useEffect(() => {
    const v = viewModeRef.current;
    if (v.editing !== editing || v.cropMode !== cropMode) {
      viewModeRef.current = { editing, cropMode };
      resetZoom();
    }
  }, [editing, cropMode, resetZoom]);

  // First zoom past fit: preload + decode the hi-res source, then swap it in.
  // For edited photos this is /edited; for untouched photos it is the original.
  // Cache hit means the swap is seamless; geometry is unchanged (same fit size).
  const [hiRes, setHiRes] = useState(false);
  useEffect(() => {
    if (!isZoomed || hiRes) return;
    let cancelled = false;
    const img = new Image();
    img.src = hiResSrc;
    img
      .decode()
      .then(() => {
        if (!cancelled) setHiRes(true);
      })
      .catch(() => {
        // Source missing/unreadable: keep showing the rendition.
      });
    return () => {
      cancelled = true;
    };
  }, [isZoomed, hiRes, hiResSrc]);
  const src = isZoomed && hiRes ? hiResSrc : shown.src;

  // Track the base display load for the blur-up. `everLoaded` latches true so the
  // display->original and Apply src swaps can't flash the blur back in.
  const { loaded, ref, onLoad } = useImageLoaded(displaySrc);
  const [everLoaded, setEverLoaded] = useState(false);
  useEffect(() => {
    const latch = () => setEverLoaded(true);
    if (loaded && !everLoaded) latch();
  }, [loaded, everLoaded]);

  const blurUrl = useMemo(
    () => thumbhashDataUrl(photo.thumbhash),
    [photo.thumbhash],
  );

  // A 90/270 rotation must be scaled so it fills the same space the re-baked
  // rendition will: ratio of "contain of the swapped image" to "contain now".
  // Uses the shown rendition's dimensions (see the double-buffer note above) and
  // the viewport from useZoomPan, so no second ResizeObserver is needed.
  let fit = 1;
  if (rotated && viewport.width > 0 && viewport.height > 0) {
    const cw = viewport.width;
    const ch = viewport.height;
    const sNow = Math.min(cw / shown.w, ch / shown.h, 1);
    const sPost = Math.min(cw / shown.h, ch / shown.w, 1);
    if (sNow > 0) fit = sPost / sNow;
  }
  const editTransform = `rotate(${t.deg}deg) scaleX(${t.mirror ? -1 : 1}) scale(${fit})`;

  // Compose the blur-box and image-loaded callback-refs onto the <img>.
  const setImg = useCallback(
    (node: HTMLImageElement | null) => {
      setImgEl(node);
      ref(node);
    },
    [setImgEl, ref],
  );

  return (
    <>
      {renderHeader({
        zoom,
        min: fitZoom,
        onZoom: setZoom,
        onStepIn: stepIn,
        onStepOut: stepOut,
        canStepIn: zoom < MAX_ZOOM - 0.5,
        canStepOut: isZoomed,
      })}
      <div
        ref={viewportRef}
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
        style={{ touchAction: "none" }}
      >
        {cropMode ? (
          <EditorCanvas src={baseSrc} onBaseSize={setBaseSize} interactive />
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
                src={baseSrc}
                fullSrc={originalSrc}
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
                      // The main <img> carries an edit-preview `transform`, which makes
                      // it establish a stacking context and paint above its in-flow
                      // siblings. Without an explicit z-index the blur would sit
                      // *behind* the image and never get to fade away over it — the
                      // blur-up reveal would be lost.
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
                  style={{
                    transform: editTransform,
                    transformOrigin: "center center",
                    transition: "none",
                  }}
                />
                {/* eslint-enable @next/next/no-img-element */}
              </>
            )}
          </div>
        )}
        {hasPrev && (
          <NavArrow
            side="left"
            label="Previous photo"
            onClick={() => step(-1)}
          />
        )}
        {hasNext && (
          <NavArrow side="right" label="Next photo" onClick={() => step(1)} />
        )}
      </div>
    </>
  );
}

function NavArrow({
  side,
  label,
  onClick,
}: {
  side: "left" | "right";
  label: string;
  onClick: () => void;
}) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  // The absolute centering (-translate-y-1/2) lives on this wrapper, not the
  // Button: the shadcn Button toggles `translate-y-px` on :active, which writes
  // the same transform and would otherwise wipe out the vertical centering on
  // click. Keeping them on separate elements lets the press-nudge coexist.
  return (
    <div
      className={cn(
        "absolute top-1/2 z-10 -translate-y-1/2",
        side === "left" ? "left-2" : "right-2",
      )}
    >
      <Button
        variant="outline"
        size="icon"
        className="backdrop-blur"
        aria-label={label}
        onClick={onClick}
      >
        <Icon className="size-5" />
      </Button>
    </div>
  );
}

function EditorCanvas({
  src,
  onBaseSize,
  interactive,
}: {
  src: string;
  onBaseSize: (s: { w: number; h: number }) => void;
  interactive: boolean;
}) {
  const { working, orientedBase, setCrop } = useEditSession();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [vp, setVp] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const apply = () => setVp({ w: el.clientWidth, h: el.clientHeight });
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const theta = working.straighten ?? 0;

  // Geometry, once the base natural size and viewport are both known.
  let layout: null | { stageW: number; stageH: number } = null;
  if (orientedBase && vp.w > 0 && vp.h > 0) {
    const pad = 32;
    const k0 = Math.min((vp.w - pad) / orientedBase.w, (vp.h - pad) / orientedBase.h);
    const oW = orientedBase.w * k0;
    const oH = orientedBase.h * k0;
    const s = straightenedSize(oW, oH, theta);
    layout = { stageW: s.w, stageH: s.h };
  }

  // Effective crop for display: an explicit crop, or the auto-fill inscribed crop
  // when straightening with no explicit crop (mirrors the bake).
  const effectiveCrop = orientedBase
    ? working.crop ??
      (theta !== 0
        ? centeredAspectCrop(orientedBase.w / orientedBase.h, orientedBase.w, orientedBase.h, theta)
        : null)
    : null;

  return (
    <div ref={wrapRef} className="relative flex h-full w-full items-center justify-center overflow-hidden">
      {layout && (
        <div className="absolute" style={{ width: layout.stageW, height: layout.stageH }}>
          {/* BaseImageStage applies color (GPU), so Crop mode shows the adjusted
              image. The CropOverlay (dim/frame/handles) sits above it. */}
          <BaseImageStage
            src={src}
            stageW={layout.stageW}
            orientedBase={orientedBase!}
            working={working}
            onNaturalSize={onBaseSize}
          />
          <CropOverlay
            stageW={layout.stageW}
            stageH={layout.stageH}
            wo={orientedBase!.w}
            ho={orientedBase!.h}
            deg={theta}
            crop={effectiveCrop}
            ratio={null}
            interactive={interactive}
            onCommit={(c) => setCrop(c)}
          />
        </div>
      )}
      {/* Before the base loads we still need its natural size: load it hidden. */}
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
