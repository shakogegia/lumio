"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PhotoDTO } from "@lumio/shared";
import { createHoldStepper, HOLD_STEP_MS } from "@/lib/hold-key-nav";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import { usePhotoCollection } from "./photo-collection";
import { LightboxSidebar } from "./lightbox-sidebar";
import { FilmStrip } from "./film-strip";
import { ZoomableImage } from "./zoomable-image";

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
          <ZoomableImage key={photo.id} photo={photo} hasPrev={hasPrev} hasNext={hasNext} step={step} />
          {strip.length > 0 && (
            <FilmStrip items={strip} currentId={photo.id} onPick={(i) => open(i)} />
          )}
        </div>
        <LightboxSidebar photo={photo} onTrashed={onTrashed} />
      </div>
    </div>
  );
}
