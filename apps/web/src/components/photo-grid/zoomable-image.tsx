"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { NO_EDITS, previewTransform, type PhotoDTO, type PhotoEdits } from "@lumio/shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { thumbhashDataUrl } from "@/lib/thumbhash-url";
import { useImageLoaded } from "@/lib/use-image-loaded";
import { displayUrl } from "@/lib/rendition-url";
import { MAX_ZOOM } from "@/lib/zoom-math";
import { useBlurBox } from "./use-blur-box";
import { useZoomPan } from "./use-zoom-pan";
import { useEditSession } from "./use-edit-session";
import { ZoomControls } from "./zoom-controls";

function sameEdits(a: PhotoEdits, b: PhotoEdits): boolean {
  return a.rotate === b.rotate && a.flipH === b.flipH && a.flipV === b.flipV;
}

export function ZoomableImage({
  photo,
  hasPrev,
  hasNext,
  step,
}: {
  photo: PhotoDTO;
  hasPrev: boolean;
  hasNext: boolean;
  step: (delta: 1 | -1) => void;
}) {
  const { working } = useEditSession();
  const savedRecipe = photo.edits ?? NO_EDITS;
  // True while previewing an unsaved edit — disables zoom and shows the live
  // rotate/flip transform instead.
  const editing = !sameEdits(working, savedRecipe);

  const displaySrc = displayUrl(photo);
  const originalSrc = `/api/photos/${photo.id}/original`;

  // Double-buffer the display rendition: when an Apply changes the rendition
  // (same photo, new ?v=), keep showing the current one — transformed by the
  // delta — until the new one has preloaded, then swap. Avoids a flash of the
  // blur placeholder or the pre-edit orientation. (`key={photo.id}` in the
  // lightbox remounts this component per photo, so this only fires on Apply.)
  const [shown, setShown] = useState<{ src: string; recipe: PhotoEdits }>({
    src: displaySrc,
    recipe: savedRecipe,
  });
  useEffect(() => {
    if (shown.src === displaySrc) return;
    let cancelled = false;
    const advance = () => {
      if (!cancelled) setShown({ src: displaySrc, recipe: savedRecipe });
    };
    const img = new Image();
    img.onload = advance;
    img.onerror = advance;
    img.src = displaySrc;
    return () => {
      cancelled = true;
    };
    // savedRecipe is captured intentionally with displaySrc (they change together).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displaySrc, shown.src]);

  const { containerRef, setImgEl, blurBox } = useBlurBox(photo.width, photo.height, photo.id);
  const {
    viewportRef,
    zoom,
    fitZoom,
    isZoomed,
    transform,
    cursor,
    setZoom,
    stepIn,
    stepOut,
    reset,
    handlers,
  } = useZoomPan(photo.width, photo.height, editing);

  // Reset zoom to fit when an edit preview starts (can't pan a rotating image).
  useEffect(() => {
    const r = () => reset();
    if (editing && isZoomed) r();
  }, [editing, isZoomed, reset]);

  // First zoom past fit (and not editing): preload + decode the full original,
  // then swap it in. Cache hit means the swap is seamless; geometry is unchanged.
  const [hiRes, setHiRes] = useState(false);
  useEffect(() => {
    if (!isZoomed || hiRes || editing) return;
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
  }, [isZoomed, hiRes, editing, originalSrc]);
  const src = isZoomed && hiRes && !editing ? originalSrc : shown.src;

  // Track the base display load for the blur-up. `everLoaded` latches true so the
  // display->original and Apply src swaps can't flash the blur back in.
  const { loaded, ref, onLoad } = useImageLoaded(displaySrc);
  const [everLoaded, setEverLoaded] = useState(false);
  useEffect(() => {
    const latch = () => setEverLoaded(true);
    if (loaded && !everLoaded) latch();
  }, [loaded, everLoaded]);

  // Natural size of the displayed rendition, for the rotate-fit calculation.
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const onImgLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      onLoad();
      const img = e.currentTarget;
      setNat({ w: img.naturalWidth, h: img.naturalHeight });
    },
    [onLoad],
  );

  // Viewport content box for the rotate-fit ratio.
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [viewportRef]);

  const blurUrl = useMemo(() => thumbhashDataUrl(photo.thumbhash), [photo.thumbhash]);

  // Live edit preview = delta from the DISPLAYED rendition's recipe to `working`.
  const t = previewTransform(shown.recipe, working);

  // Continuous rotation so repeated rotations animate forward through a full
  // circle instead of unwinding (CSS would take the short path 270°→0°).
  const [contDeg, setContDeg] = useState(t.deg);
  useEffect(() => {
    const bump = () =>
      setContDeg((prev) => {
        const diff = (((t.deg - prev) % 360) + 360) % 360;
        return prev + (diff > 180 ? diff - 360 : diff);
      });
    bump();
  }, [t.deg]);

  // Suppress the rotation transition on the frame the rendition swaps (Apply /
  // nav) so the buffer swap is instant; edit-rotate clicks animate. Flips never
  // animate — the mirror lives on the <img> with no transition (below).
  const [animate, setAnimate] = useState(false);
  useEffect(() => {
    const enable = (v: boolean) => setAnimate(v);
    enable(false);
    const id = requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(id);
  }, [shown.src]);

  const rotated = t.deg === 90 || t.deg === 270;
  let fit = 1;
  if (rotated && nat && box) {
    const cw = Math.max(1, box.w);
    const ch = Math.max(1, box.h);
    const sNow = Math.min(cw / nat.w, ch / nat.h, 1);
    const sPost = Math.min(cw / nat.h, ch / nat.w, 1);
    if (sNow > 0) fit = sPost / sNow;
  }
  // Rotation + fit animate (on a wrapper); the mirror is applied to the <img>
  // with no transition so flips are instant (a CSS scale through 0 would collapse).
  const rotateTransform = `rotate(${contDeg}deg) scale(${fit})`;
  const mirrorTransform = `scaleX(${t.mirror ? -1 : 1})`;

  // Compose the blur-box and image-loaded callback-refs onto the <img>.
  const setImg = useCallback(
    (node: HTMLImageElement | null) => {
      setImgEl(node);
      ref(node);
    },
    [setImgEl, ref],
  );

  return (
    <div
      ref={viewportRef}
      className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
      style={{ touchAction: "none" }}
    >
      <div
        ref={containerRef}
        className="absolute inset-0 flex items-center justify-center"
        style={{ transform, transformOrigin: "center", cursor: editing ? "default" : cursor }}
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
            className="pointer-events-none absolute rounded-sm object-cover transition-opacity duration-500"
            style={{
              left: blurBox.left,
              top: blurBox.top,
              width: blurBox.width,
              height: blurBox.height,
              opacity: everLoaded ? 0 : 1,
            }}
          />
        )}
        <div
          className="flex h-full w-full items-center justify-center"
          style={{
            transform: rotateTransform,
            transformOrigin: "center center",
            transition: animate ? "transform 200ms cubic-bezier(0.22, 1, 0.36, 1)" : "none",
          }}
        >
          <img
            ref={setImg}
            src={src}
            alt={photo.path}
            width={photo.width}
            height={photo.height}
            onLoad={onImgLoad}
            draggable={false}
            className="max-h-[80vh] w-full select-none object-contain lg:max-h-full lg:w-auto lg:max-w-full"
            style={{ transform: mirrorTransform, transformOrigin: "center center", transition: "none" }}
          />
        </div>
        {/* eslint-enable @next/next/no-img-element */}
      </div>
      {!editing && (
        <ZoomControls
          zoom={zoom}
          min={fitZoom}
          onZoom={setZoom}
          onStepIn={stepIn}
          onStepOut={stepOut}
          canStepIn={zoom < MAX_ZOOM - 0.5}
          canStepOut={isZoomed}
        />
      )}
      {hasPrev && <NavArrow side="left" label="Previous photo" onClick={() => step(-1)} />}
      {hasNext && <NavArrow side="right" label="Next photo" onClick={() => step(1)} />}
    </div>
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
    <div className={cn("absolute top-1/2 z-10 -translate-y-1/2", side === "left" ? "left-2" : "right-2")}>
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
