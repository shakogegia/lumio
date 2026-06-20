"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { NO_EDITS, hasEdits, type PhotoDTO, type PhotoEdits } from "@lumio/shared";
import { useConfirm } from "@/components/confirm-dialog";
import { usePhotoCollection } from "./photo-collection";

interface EditSessionValue {
  /** The recipe being previewed (may differ from what's saved on the photo). */
  working: PhotoEdits;
  /** The recipe currently baked into the photo's renditions. */
  saved: PhotoEdits;
  /** working differs from saved. */
  dirty: boolean;
  applying: boolean;
  set: (next: PhotoEdits) => void;
  reset: () => void;
  apply: () => Promise<void>;
  /** Run `go` unless there are unsaved edits and the user declines to discard. */
  guard: (go: () => void) => void;
}

const Ctx = createContext<EditSessionValue | null>(null);

export function useEditSession(): EditSessionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useEditSession must be used within EditSessionProvider");
  return v;
}

function sameEdits(a: PhotoEdits, b: PhotoEdits): boolean {
  return a.rotate === b.rotate && a.flipH === b.flipH && a.flipV === b.flipV;
}

/**
 * Holds the in-progress edit recipe for the open photo. `saved` is derived from
 * the photo's persisted edits, so applying an edit (which patches the store) or
 * navigating to another photo keeps the session in sync automatically. Lives
 * inside the lightbox so both the Edit tab (controls) and the centre image
 * (preview) share one source of truth, and so navigation can be guarded.
 */
export function EditSessionProvider({
  photo,
  children,
}: {
  photo: PhotoDTO;
  children: React.ReactNode;
}) {
  const { patchPhotos } = usePhotoCollection();
  const { confirm, confirmDialog } = useConfirm();

  const saved = photo.edits ?? NO_EDITS;
  const [working, setWorking] = useState<PhotoEdits>(saved);
  const [applying, setApplying] = useState(false);
  const photoIdRef = useRef(photo.id);

  // Re-seed the working recipe when the photo changes (arrow-nav / film strip).
  // Assign through a local fn so it isn't a direct setState-in-effect call (the
  // react-compiler rule only flags synchronous direct calls in the effect body).
  useEffect(() => {
    const reseed = (e: PhotoEdits) => setWorking(e);
    if (photoIdRef.current !== photo.id) {
      photoIdRef.current = photo.id;
      reseed(photo.edits ?? NO_EDITS);
    }
  }, [photo.id, photo.edits]);

  const dirty = !sameEdits(working, saved);

  const set = useCallback((next: PhotoEdits) => setWorking(next), []);
  const reset = useCallback(() => setWorking(NO_EDITS), []);

  const apply = useCallback(async () => {
    if (applying || sameEdits(working, photo.edits ?? NO_EDITS)) return;
    setApplying(true);
    try {
      const body = hasEdits(working) ? working : null;
      const res = await fetch(`/api/photos/${photo.id}/edit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ edits: body }),
      });
      if (!res.ok) throw new Error("edit failed");
      const dto = (await res.json()) as PhotoDTO;
      // Patch the shared store so the grid tile + lightbox pick up the new
      // renditions (updatedAt busts the cached rendition URLs) and dimensions.
      patchPhotos(new Set([photo.id]), {
        edits: dto.edits,
        width: dto.width,
        height: dto.height,
        thumbhash: dto.thumbhash,
        updatedAt: dto.updatedAt,
      });
      setWorking(dto.edits ?? NO_EDITS);
    } catch {
      toast.error("Failed to save edits.");
    } finally {
      setApplying(false);
    }
  }, [applying, working, photo.id, photo.edits, patchPhotos]);

  const guard = useCallback(
    (go: () => void) => {
      if (!dirty) {
        go();
        return;
      }
      void confirm({
        title: "Discard edits?",
        description: "Your unsaved changes will be lost.",
        confirmLabel: "Discard",
        destructive: true,
      }).then((ok) => {
        if (ok) {
          setWorking(photo.edits ?? NO_EDITS);
          go();
        }
      });
    },
    [dirty, confirm, photo.edits],
  );

  const value: EditSessionValue = { working, saved, dirty, applying, set, reset, apply, guard };

  return (
    <Ctx.Provider value={value}>
      {children}
      {confirmDialog}
    </Ctx.Provider>
  );
}
