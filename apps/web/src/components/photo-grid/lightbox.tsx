"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { PhotoDTO } from "@lumio/shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { createHoldStepper, HOLD_STEP_MS } from "@/lib/hold-key-nav";
import { thumbhashDataUrl } from "@/lib/thumbhash-url";
import { useImageLoaded } from "@/lib/use-image-loaded";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import { useBlurBox } from "./use-blur-box";
import { usePhotoCollection } from "./photo-collection";
import { LightboxSidebar } from "./lightbox-sidebar";
import { FilmStrip } from "./film-strip";

export function Lightbox() {
  const { openIndex, photoAt, total, step, close, open } = usePhotoCollection();
  const overlayRef = useRef<HTMLDivElement>(null);

  // Remember the last resolved photo so a transient store gap (e.g. the page
  // evicted right after a move-to-trash, or stepping to a not-yet-loaded
  // neighbor) doesn't unmount the whole overlay — which would release the scroll
  // lock and jump the grid behind. We keep showing the last photo for the frame
  // or two until photoAt() refills, then swap to the new one.
  const [lastPhoto, setLastPhoto] = useState<PhotoDTO | undefined>(undefined);
  const resolved = openIndex === null ? undefined : photoAt(openIndex);
  useEffect(() => {
    // Update via a callback so the assignment is not a direct setState-in-effect
    // call (the rule only flags synchronous direct calls in the effect body).
    const update = (p: PhotoDTO) => setLastPhoto(p);
    if (resolved) update(resolved);
  }, [resolved]);
  const photo = resolved ?? (openIndex === null ? undefined : lastPhoto);

  useBodyScrollLock(openIndex !== null, overlayRef);

  // Latest values for the persistent keyboard stepper, refreshed after each commit
  // (writing refs during render is disallowed by react-hooks/refs).
  const stepRef = useRef(step);
  const openRef = useRef(openIndex);
  const totalRef = useRef(total);
  useEffect(() => {
    stepRef.current = step;
    openRef.current = openIndex;
    totalRef.current = total;
  });

  const isOpen = openIndex !== null;
  useEffect(() => {
    if (!isOpen) return;
    const stepper = createHoldStepper({
      getTarget: () => ({
        canStep: (dir) => {
          const i = openRef.current;
          if (i === null) return false;
          return dir === "next"
            ? totalRef.current !== null && i < totalRef.current - 1
            : i > 0;
        },
        step: (dir) => stepRef.current(dir === "next" ? 1 : -1),
      }),
      schedule: (fn) => {
        const id = setInterval(fn, HOLD_STEP_MS);
        return () => clearInterval(id);
      },
    });
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        close();
        return;
      }
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.repeat) return;
      if (e.key === "ArrowLeft") stepper.press("prev");
      else if (e.key === "ArrowRight") stepper.press("next");
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") stepper.release("prev");
      else if (e.key === "ArrowRight") stepper.release("next");
    };
    const onBlur = () => stepper.stop();
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      stepper.stop();
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [isOpen, close]);

  const onTrashed = () => {
    // Were we on the last photo? close. Otherwise the store shifts the next photo
    // into this index and the provider's URL-sync effect updates the address bar.
    if (openIndex === null || total === null || openIndex >= total - 1) close();
  };

  const STRIP_RADIUS = 25;
  const strip = useMemo(() => {
    if (openIndex === null) return [];
    const lo = Math.max(0, openIndex - STRIP_RADIUS);
    // `total` is null until the store's first page loads (deep-link / refresh).
    // Don't gate the strip on it — include whatever's already loaded (at least the
    // SSR'd photo at openIndex) so the strip renders at its final height from the
    // first paint instead of popping in a moment later and shifting the image up.
    const hi =
      total === null ? openIndex + STRIP_RADIUS : Math.min(total - 1, openIndex + STRIP_RADIUS);
    const out: { id: string; index: number }[] = [];
    for (let i = lo; i <= hi; i++) {
      const p = photoAt(i);
      if (p) out.push({ id: p.id, index: i });
    }
    return out;
  }, [openIndex, total, photoAt]);

  if (openIndex === null || !photo) return null;

  const hasPrev = openIndex > 0;
  const hasNext = total !== null && openIndex < total - 1;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-y-0 left-[76px] right-0 z-40 overflow-y-auto bg-background lg:bg-background/85 lg:backdrop-blur-xl"
      onClick={(e) => {
        // Click on the backdrop (not a child) closes.
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="flex flex-col lg:h-dvh lg:flex-row">
        <div className="flex min-w-0 flex-1 flex-col">
          <LightboxImage photo={photo} hasPrev={hasPrev} hasNext={hasNext} step={step} />
          {strip.length > 0 && (
            <FilmStrip
              items={strip}
              currentId={photo.id}
              onPick={(i) => open(i)}
              onStep={step}
            />
          )}
        </div>
        <LightboxSidebar photo={photo} onTrashed={onTrashed} />
      </div>
    </div>
  );
}

function LightboxImage({
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
  const src = `/api/photos/${photo.id}/display`;
  const { loaded, ref, onLoad } = useImageLoaded(src);
  const blurUrl = useMemo(() => thumbhashDataUrl(photo.thumbhash), [photo.thumbhash]);
  const { containerRef, setImgEl, blurBox } = useBlurBox(photo.width, photo.height, photo.id);

  // Compose the two callback-refs onto the <img>: setImgEl (blur-box measurement)
  // and ref (useImageLoaded). Both are callback-refs, so we can call them directly
  // in a useCallback without any .current mutation (avoids react-hooks/immutability).
  const setImg = useCallback(
    (node: HTMLImageElement | null) => {
      setImgEl(node);
      ref(node);
    },
    [setImgEl, ref],
  );

  return (
    <div ref={containerRef} className="relative flex min-h-0 flex-1 items-center justify-center p-4">
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
            opacity: loaded ? 0 : 1,
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
        className="max-h-[80vh] w-full object-contain lg:max-h-full lg:w-auto lg:max-w-full"
      />
      {/* eslint-enable @next/next/no-img-element */}
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
    <div className={cn("absolute top-1/2 -translate-y-1/2", side === "left" ? "left-2" : "right-2")}>
      <Button variant="outline" size="icon" className="backdrop-blur" aria-label={label} onClick={onClick}>
        <Icon className="size-5" />
      </Button>
    </div>
  );
}
