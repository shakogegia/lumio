"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { NO_EDITS, previewTransform, type PhotoDTO } from "@lumio/shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { createHoldStepper, HOLD_STEP_MS } from "@/lib/hold-key-nav";
import { thumbhashDataUrl } from "@/lib/thumbhash-url";
import { useImageLoaded } from "@/lib/use-image-loaded";
import { displayUrl, renditionVersion } from "@/lib/rendition-url";
import { useBodyScrollLock } from "@/lib/use-body-scroll-lock";
import { useBlurBox } from "./use-blur-box";
import { usePhotoCollection } from "./photo-collection";
import { EditSessionProvider, useEditSession } from "./use-edit-session";
import { LightboxSidebar } from "./lightbox-sidebar";
import { FilmStrip } from "./film-strip";

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
  const { guard, dirty } = useEditSession();
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
  useEffect(() => {
    stepRef.current = step;
    closeRef.current = close;
    openIdxRef.current = openIndex;
    totalRef.current = total;
    guardRef.current = guard;
    dirtyRef.current = dirty;
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
          <LightboxImage
            photo={photo}
            hasPrev={hasPrev}
            hasNext={hasNext}
            onStep={(d) => guard(() => step(d))}
          />
          {strip.length > 0 && (
            <FilmStrip
              items={strip}
              currentId={photo.id}
              onPick={(i) => guard(() => open(i))}
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
  onStep,
}: {
  photo: PhotoDTO;
  hasPrev: boolean;
  hasNext: boolean;
  onStep: (delta: 1 | -1) => void;
}) {
  const { working } = useEditSession();

  // What the photo SHOULD show right now (recipe baked into its renditions).
  const target = useMemo(
    () => ({ src: displayUrl(photo), recipe: photo.edits ?? NO_EDITS, photoId: photo.id }),
    [photo],
  );
  // Double-buffer: `disp` is the rendition actually on screen. We only advance it
  // to a new SAME-photo rendition (after Apply) once that rendition has preloaded,
  // and we keep the live transform measured against `disp.recipe` — so the swap
  // from "old rendition + CSS transform" to "new baked rendition" is seamless
  // (no blur placeholder, no flash of the pre-edit orientation).
  const [disp, setDisp] = useState(target);
  const [allowBlur, setAllowBlur] = useState(true);
  useEffect(() => {
    if (target.photoId !== disp.photoId) {
      const swap = () => {
        setDisp(target);
        setAllowBlur(true); // new photo → blur placeholder is appropriate
      };
      swap();
      return;
    }
    if (target.src !== disp.src) {
      // Same photo, new rendition (Apply): preload, then swap with no blur.
      let cancelled = false;
      const finish = () => {
        if (cancelled) return;
        setDisp(target);
        setAllowBlur(false);
      };
      const img = new Image();
      img.onload = finish;
      img.onerror = finish;
      img.src = target.src;
      return () => {
        cancelled = true;
      };
    }
  }, [target, disp.photoId, disp.src]);

  // Suppress the transform transition on the frame the rendition swaps (Apply /
  // nav) so the buffer swap is instant; edit clicks (disp unchanged) animate.
  const [animate, setAnimate] = useState(false);
  useEffect(() => {
    const enable = (v: boolean) => setAnimate(v);
    enable(false);
    const id = requestAnimationFrame(() => setAnimate(true));
    return () => cancelAnimationFrame(id);
  }, [disp.src, disp.photoId]);

  const { loaded, ref, onLoad } = useImageLoaded(disp.src);
  const blurUrl = useMemo(() => thumbhashDataUrl(photo.thumbhash), [photo.thumbhash]);
  const { containerRef, setImgEl, blurBox } = useBlurBox(photo.width, photo.height, photo.id);

  // Natural size of the displayed rendition (for the rotate fit math).
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const onImgLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      onLoad();
      const img = e.currentTarget;
      setNat({ w: img.naturalWidth, h: img.naturalHeight });
    },
    [onLoad],
  );

  // Track the container's content box for the contain-fit calculation.
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [containerRef]);

  // Compose callback-refs onto the <img>: setImgEl (blur-box) + ref (loaded).
  const setImg = useCallback(
    (node: HTMLImageElement | null) => {
      setImgEl(node);
      ref(node);
    },
    [setImgEl, ref],
  );

  // Preview = delta from the DISPLAYED rendition's recipe to `working`.
  const t = previewTransform(disp.recipe, working);
  const identity = t.deg === 0 && !t.mirror;
  const rotated = t.deg === 90 || t.deg === 270;
  // A 90/270 rotation must be scaled so it fills the same space the re-baked
  // rendition will: ratio of "contain of the swapped image" to "contain now".
  let fit = 1;
  if (rotated && nat && box) {
    const cw = Math.max(1, box.w - 32); // container minus p-4 (16px each side)
    const ch = Math.max(1, box.h - 32);
    const sNow = Math.min(cw / nat.w, ch / nat.h, 1);
    const sPost = Math.min(cw / nat.h, ch / nat.w, 1);
    if (sNow > 0) fit = sPost / sNow;
  }
  const transform = identity
    ? undefined
    : `rotate(${t.deg}deg) scaleX(${t.mirror ? -1 : 1}) scale(${fit})`;

  return (
    <div ref={containerRef} className="relative flex min-h-0 flex-1 items-center justify-center p-4">
      {/* eslint-disable @next/next/no-img-element */}
      {allowBlur && blurUrl && blurBox && (
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
        src={disp.src}
        alt={photo.path}
        width={nat?.w ?? photo.width}
        height={nat?.h ?? photo.height}
        onLoad={onImgLoad}
        className="max-h-[80vh] w-full object-contain lg:max-h-full lg:w-auto lg:max-w-full"
        style={{
          transform,
          transformOrigin: "center center",
          transition: animate ? "transform 200ms cubic-bezier(0.22, 1, 0.36, 1)" : "none",
        }}
      />
      {/* eslint-enable @next/next/no-img-element */}
      {hasPrev && <NavArrow side="left" label="Previous photo" onClick={() => onStep(-1)} />}
      {hasNext && <NavArrow side="right" label="Next photo" onClick={() => onStep(1)} />}
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
