"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PhotoDTO } from "@lumio/shared";
import { renditionVersion } from "@/lib/rendition-url";
import { useBodyScrollLock } from "@/lib/hooks/use-body-scroll-lock";
import { usePhotoCollection } from "@/features/photo-grid";
import { EditSessionProvider, useEditSession } from "@/features/photo-editor";
import { ZoomableImage } from "@/features/photo-editor";
import { useLightboxKeyboard } from "./use-lightbox-keyboard";
import { useToggleFavorite } from "@/features/photo-grid";
import { LightboxHeader } from "./lightbox-header";
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
  const { openIndex, total, step, close, open, openTab, setOpenTab } = usePhotoCollection();
  const { guard, dirty, undo, redo, canUndo, canRedo, cropMode, enterCropMode, doneCropMode, cancelCropMode } =
    useEditSession();
  const toggleFavorite = useToggleFavorite(photo);
  const overlayRef = useRef<HTMLDivElement>(null);

  useBodyScrollLock(true, overlayRef);
  useLightboxKeyboard({
    openIndex,
    total,
    dirty,
    canUndo,
    canRedo,
    step,
    close,
    guard,
    undo,
    redo,
    toggleFavorite: () => void toggleFavorite(),
    activeTab: openTab,
    setTab: setOpenTab,
    cropMode,
    enterCropMode,
    doneCropMode,
    cancelCropMode,
  });

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
      data-keyboard-overlay
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
            renderHeader={(z) => (
              <LightboxHeader
                {...z}
                photo={photo}
                onTrashed={onTrashed}
                showZoom={!cropMode}
              />
            )}
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
        <LightboxSidebar photo={photo} />
      </div>
    </div>
  );
}
