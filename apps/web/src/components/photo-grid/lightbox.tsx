"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PhotoDTO } from "@lumio/shared";
import { createHoldStepper, HOLD_STEP_MS } from "@/lib/hold-key-nav";
import { renditionVersion } from "@/lib/rendition-url";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import { usePhotoCollection } from "./photo-collection";
import { EditSessionProvider, useEditSession } from "./use-edit-session";
import { LightboxSidebar } from "./lightbox-sidebar";
import { FilmStrip } from "./film-strip";
import { ZoomableImage } from "./zoomable-image";

type StripItem = { id: string; index: number; v: number };

export function Lightbox() {
  const { openIndex, photoAt, total } = usePhotoCollection();

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

  const STRIP_RADIUS = 25;
  const strip = useMemo<StripItem[]>(() => {
    if (openIndex === null) return [];
    const lo = Math.max(0, openIndex - STRIP_RADIUS);
    // `total` is null until the store's first page loads (deep-link / refresh).
    // Don't gate the strip on it — include whatever's already loaded (at least the
    // SSR'd photo at openIndex) so the strip renders at its final height from the
    // first paint instead of popping in a moment later and shifting the image up.
    const hi =
      total === null ? openIndex + STRIP_RADIUS : Math.min(total - 1, openIndex + STRIP_RADIUS);
    const out: StripItem[] = [];
    for (let i = lo; i <= hi; i++) {
      const p = photoAt(i);
      if (p) out.push({ id: p.id, index: i, v: renditionVersion(p.updatedAt) });
    }
    return out;
  }, [openIndex, total, photoAt]);

  if (openIndex === null || !photo) return null;

  return (
    <EditSessionProvider photo={photo}>
      <LightboxOverlay photo={photo} strip={strip} />
    </EditSessionProvider>
  );
}

function LightboxOverlay({ photo, strip }: { photo: PhotoDTO; strip: StripItem[] }) {
  const { openIndex, total, step, close, open } = usePhotoCollection();
  const { guard, dirty, undo, redo, canUndo, canRedo } = useEditSession();
  const overlayRef = useRef<HTMLDivElement>(null);

  useBodyScrollLock(true, overlayRef);

  // Latest values for the persistent keyboard stepper + guarded nav, refreshed
  // after each commit (writing refs during render is disallowed by the lint).
  const stepRef = useRef(step);
  const closeRef = useRef(close);
  const openIdxRef = useRef(openIndex);
  const totalRef = useRef(total);
  const guardRef = useRef(guard);
  const dirtyRef = useRef(dirty);
  const undoRef = useRef(undo);
  const redoRef = useRef(redo);
  const canUndoRef = useRef(canUndo);
  const canRedoRef = useRef(canRedo);
  useEffect(() => {
    stepRef.current = step;
    closeRef.current = close;
    openIdxRef.current = openIndex;
    totalRef.current = total;
    guardRef.current = guard;
    dirtyRef.current = dirty;
    undoRef.current = undo;
    redoRef.current = redo;
    canUndoRef.current = canUndo;
    canRedoRef.current = canRedo;
  });

  useEffect(() => {
    const stepper = createHoldStepper({
      getTarget: () => ({
        canStep: (dir) => {
          const i = openIdxRef.current;
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
        guardRef.current(() => closeRef.current());
        return;
      }
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      // Undo / redo edits: Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z, or Ctrl+Y.
      if ((e.metaKey || e.ctrlKey) && (e.key === "z" || e.key === "Z")) {
        if (e.shiftKey) {
          if (canRedoRef.current) {
            e.preventDefault();
            redoRef.current();
          }
        } else if (canUndoRef.current) {
          e.preventDefault();
          undoRef.current();
        }
        return;
      }
      if (e.ctrlKey && !e.metaKey && (e.key === "y" || e.key === "Y")) {
        if (canRedoRef.current) {
          e.preventDefault();
          redoRef.current();
        }
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      const delta: 1 | -1 = e.key === "ArrowRight" ? 1 : -1;
      // With unsaved edits, a single press prompts to discard (no hold-repeat, so
      // the confirm dialog doesn't fire on every interval tick).
      if (dirtyRef.current) {
        if (e.repeat) return;
        guardRef.current(() => stepRef.current(delta));
        return;
      }
      if (e.repeat) return;
      stepper.press(delta === 1 ? "next" : "prev");
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (dirtyRef.current) return;
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
  }, []);

  const onTrashed = useCallback(() => {
    // Were we on the last photo? close. Otherwise the store shifts the next photo
    // into this index and the provider's URL-sync effect updates the address bar.
    if (openIndex === null || total === null || openIndex >= total - 1) close();
  }, [openIndex, total, close]);

  const hasPrev = openIndex !== null && openIndex > 0;
  const hasNext = openIndex !== null && total !== null && openIndex < total - 1;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-y-0 left-[76px] right-0 z-40 overflow-y-auto bg-background lg:bg-background/85 lg:backdrop-blur-xl"
      onClick={(e) => {
        // Click on the backdrop (not a child) closes — guarded for unsaved edits.
        if (e.target === e.currentTarget) guard(() => close());
      }}
    >
      <div className="flex flex-col lg:h-dvh lg:flex-row">
        <div className="flex min-w-0 flex-1 flex-col">
          <ZoomableImage
            key={photo.id}
            photo={photo}
            hasPrev={hasPrev}
            hasNext={hasNext}
            step={(d) => guard(() => step(d))}
          />
          {strip.length > 0 && (
            <FilmStrip
              items={strip}
              currentId={photo.id}
              onPick={(i) => guard(() => open(i))}
              onStep={(d) => guard(() => step(d))}
            />
          )}
        </div>
        <LightboxSidebar photo={photo} onTrashed={onTrashed} />
      </div>
    </div>
  );
}
