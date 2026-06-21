"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  NO_EDITS,
  previewTransform,
  type PhotoDTO,
  type PhotoEdits,
} from "@lumio/shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { thumbhashDataUrl } from "@/lib/thumbhash-url";
import { useImageLoaded } from "@/lib/use-image-loaded";
import { displayUrl } from "@/lib/rendition-url";
import { MAX_ZOOM } from "@/lib/zoom-math";
import { useBlurBox } from "./use-blur-box";
import { useZoomPan } from "./use-zoom-pan";
import { useEditSession } from "./use-edit-session";
import { LightboxHeader } from "./lightbox-header";

export function ZoomableImage({
  photo,
  hasPrev,
  hasNext,
  step,
  onTrashed,
}: {
  photo: PhotoDTO;
  hasPrev: boolean;
  hasNext: boolean;
  step: (delta: 1 | -1) => void;
  onTrashed: () => void;
}) {
  const { working, editing, setBaseSize } = useEditSession();
  const savedRecipe = photo.edits ?? NO_EDITS;

  const displaySrc = displayUrl(photo);
  const originalSrc = `/api/photos/${photo.id}/original`;
  const editBaseSrc = `/api/photos/${photo.id}/edit-base`;

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
  // Feed the zoom/pan engine the *previewed* orientation, so a rotated-but-unsaved
  // image still pans and fits correctly (a 90/270 delta swaps width and height).
  // Uses the shown rendition's dimensions — see the double-buffer note above.
  const viewW = rotated ? shown.h : shown.w;
  const viewH = rotated ? shown.w : shown.h;

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
  } = useZoomPan(viewW, viewH);

  // First zoom past fit: preload + decode the full original, then swap it in.
  // Cache hit means the swap is seamless; geometry is unchanged (same fit size).
  const [hiRes, setHiRes] = useState(false);
  useEffect(() => {
    if (!isZoomed || hiRes) return;
    let cancelled = false;
    const img = new Image();
    img.src = originalSrc;
    img
      .decode()
      .then(() => {
        if (!cancelled) setHiRes(true);
      })
      .catch(() => {
        // Original missing/unreadable: keep showing the rendition.
      });
    return () => {
      cancelled = true;
    };
  }, [isZoomed, hiRes, originalSrc]);
  const src = isZoomed && hiRes ? originalSrc : shown.src;

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
      <LightboxHeader
        photo={photo}
        onTrashed={onTrashed}
        zoom={zoom}
        min={fitZoom}
        onZoom={setZoom}
        onStepIn={stepIn}
        onStepOut={stepOut}
        canStepIn={zoom < MAX_ZOOM - 0.5}
        canStepOut={isZoomed}
      />
      <div
        ref={viewportRef}
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
        style={{ touchAction: "none" }}
      >
        {editing ? (
          <EditorCanvas src={editBaseSrc} onBaseSize={setBaseSize} />
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
}: {
  src: string;
  onBaseSize: (s: { w: number; h: number }) => void;
}) {
  const { working } = useEditSession();
  const deg = working.rotate + (working.straighten ?? 0);
  const sx = working.flipH ? -1 : 1;
  const sy = working.flipV ? -1 : 1;
  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        draggable={false}
        onLoad={(e) =>
          onBaseSize({
            w: e.currentTarget.naturalWidth,
            h: e.currentTarget.naturalHeight,
          })
        }
        className="max-h-full max-w-full select-none object-contain"
        style={{
          transform: `rotate(${deg}deg) scaleX(${sx}) scaleY(${sy})`,
          transformOrigin: "center center",
        }}
      />
    </div>
  );
}
