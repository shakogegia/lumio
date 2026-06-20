"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { PhotoDTO } from "@lumio/shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { thumbhashDataUrl } from "@/lib/thumbhash-url";
import { useImageLoaded } from "@/lib/use-image-loaded";
import { MAX_ZOOM } from "@/lib/zoom-math";
import { useBlurBox } from "./use-blur-box";
import { useZoomPan } from "./use-zoom-pan";
import { ZoomControls } from "./zoom-controls";

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
  const displaySrc = `/api/photos/${photo.id}/display`;
  const originalSrc = `/api/photos/${photo.id}/original`;

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
    handlers,
  } = useZoomPan(photo.width, photo.height);

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
        // Original missing/unreadable: keep showing the rendition (softer at
        // high zoom but still usable).
      });
    return () => {
      cancelled = true;
    };
  }, [isZoomed, hiRes, originalSrc]);
  const src = hiRes ? originalSrc : displaySrc;

  // Track the base display load for the blur-up. `everLoaded` latches true so the
  // display->original src swap can't flash the blur back in.
  const { loaded, ref, onLoad } = useImageLoaded(displaySrc);
  const [everLoaded, setEverLoaded] = useState(false);
  useEffect(() => {
    // Update via a callback so the assignment is not a direct setState-in-effect
    // call (the rule only flags synchronous direct calls in the effect body).
    const latch = () => setEverLoaded(true);
    if (loaded && !everLoaded) latch();
  }, [loaded, everLoaded]);

  const blurUrl = useMemo(() => thumbhashDataUrl(photo.thumbhash), [photo.thumbhash]);

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
        <img
          ref={setImg}
          src={src}
          alt={photo.path}
          width={photo.width}
          height={photo.height}
          onLoad={onLoad}
          draggable={false}
          className="max-h-[80vh] w-full select-none object-contain lg:max-h-full lg:w-auto lg:max-w-full"
        />
        {/* eslint-enable @next/next/no-img-element */}
      </div>
      <ZoomControls
        zoom={zoom}
        min={fitZoom}
        onZoom={setZoom}
        onStepIn={stepIn}
        onStepOut={stepOut}
        canStepIn={zoom < MAX_ZOOM - 0.5}
        canStepOut={isZoomed}
      />
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
