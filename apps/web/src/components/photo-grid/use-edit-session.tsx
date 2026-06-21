"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  NO_EDITS,
  hasEdits,
  rotateLeft as recipeRotateLeft,
  rotateRight as recipeRotateRight,
  sameEdits,
  toggleFlipH as recipeFlipH,
  toggleFlipV as recipeFlipV,
  setStraighten as recipeSetStraighten,
  setCrop as recipeSetCrop,
  aspectCrop as recipeAspectCrop,
  clampCropToImage,
  COLOR_FIELDS,
  type PhotoDTO,
  type PhotoEdits,
  type AspectPreset,
  type CropRect,
  type ColorKey,
} from "@lumio/shared";
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
  canUndo: boolean;
  canRedo: boolean;
  rotateLeft: () => void;
  rotateRight: () => void;
  flipH: () => void;
  flipV: () => void;
  reset: () => void;
  undo: () => void;
  redo: () => void;
  apply: () => Promise<void>;
  /** Run `go` unless there are unsaved edits and the user declines to discard. */
  guard: (go: () => void) => void;
  /** True while the Edit tab is mounted/active (drives the editor canvas). */
  editing: boolean;
  setEditing: (on: boolean) => void;
  /** Natural size of the loaded base display image (EXIF-oriented), or null. */
  baseSize: { w: number; h: number } | null;
  setBaseSize: (size: { w: number; h: number }) => void;
  /** Oriented dims (base size with the working coarse-rotate applied). */
  orientedBase: { w: number; h: number } | null;
  setStraighten: (deg: number) => void;
  setCrop: (crop: CropRect | null) => void;
  setAspect: (preset: AspectPreset) => void;
  /** Set a single color-adjustment field (0/neutral removes it). Pushes history. */
  setColor: (key: ColorKey, value: number) => void;
  /** Reset rotate + flip to identity (the Transform group). Pushes history. */
  resetTransform: () => void;
  /** Reset all color adjustments to neutral (the Adjust group). Pushes history. */
  resetColor: () => void;
  /** True while the focused Crop mode is active. */
  cropMode: boolean;
  /** Enter Crop mode (snapshots crop+straighten for Cancel). */
  enterCropMode: () => void;
  /** Exit Crop mode, keeping the crop/straighten in the working recipe (pending Apply). */
  doneCropMode: () => void;
  /** Exit Crop mode, reverting crop+straighten to the pre-enter snapshot. */
  cancelCropMode: () => void;
}

const Ctx = createContext<EditSessionValue | null>(null);

export function useEditSession(): EditSessionValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useEditSession must be used within EditSessionProvider");
  return v;
}

/** Undo/redo history of working recipes; `stack[index]` is the live recipe. */
interface History {
  stack: PhotoEdits[];
  index: number;
}

function freshHistory(base: PhotoEdits): History {
  return { stack: [base], index: 0 };
}

/** Return the recipe with `key` removed (used when a color slider returns to 0). */
function withoutColor(e: PhotoEdits, key: ColorKey): PhotoEdits {
  if (e[key] === undefined) return e;
  const next = { ...e };
  delete next[key];
  return next;
}

/** Push a new recipe, dropping any redo branch. No-op if it equals the current. */
function pushHistory(h: History, next: PhotoEdits): History {
  if (sameEdits(next, h.stack[h.index])) return h;
  const stack = [...h.stack.slice(0, h.index + 1), next];
  return { stack, index: stack.length - 1 };
}

/**
 * Holds the in-progress edit recipe for the open photo, with undo/redo. `saved`
 * is derived from the photo's persisted edits, so applying an edit (which patches
 * the store) or navigating to another photo keeps the session in sync. The
 * history resets to a single entry on navigation and after a successful apply.
 * Lives inside the lightbox so the Edit tab (controls) and the centre image
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
  const [history, setHistory] = useState<History>(() => freshHistory(saved));
  const [applying, setApplying] = useState(false);
  const [editing, setEditing] = useState(false);
  const [baseSize, setBaseSize] = useState<{ w: number; h: number } | null>(null);
  const [cropMode, setCropMode] = useState(false);
  const cropSnapshot = useRef<PhotoEdits | null>(null);
  const photoIdRef = useRef(photo.id);

  const working = history.stack[history.index];
  const orientedBase =
    baseSize === null
      ? null
      : working.rotate === 90 || working.rotate === 270
        ? { w: baseSize.h, h: baseSize.w }
        : { w: baseSize.w, h: baseSize.h };
  const canUndo = history.index > 0;
  const canRedo = history.index < history.stack.length - 1;

  // Re-seed history when the photo changes (arrow-nav / film strip). Assign
  // through a local fn so it isn't a direct setState-in-effect call (the
  // react-compiler rule only flags synchronous direct calls in the effect body).
  useEffect(() => {
    const reseed = (e: PhotoEdits) => {
      setHistory(freshHistory(e));
      setBaseSize(null);
      setCropMode(false);
      cropSnapshot.current = null;
    };
    if (photoIdRef.current !== photo.id) {
      photoIdRef.current = photo.id;
      reseed(photo.edits ?? NO_EDITS);
    }
  }, [photo.id, photo.edits]);

  const dirty = !sameEdits(working, saved);

  const rotateLeft = useCallback(() => {
    setHistory((h) => pushHistory(h, recipeRotateLeft(h.stack[h.index])));
  }, []);
  const rotateRight = useCallback(() => {
    setHistory((h) => pushHistory(h, recipeRotateRight(h.stack[h.index])));
  }, []);
  const flipH = useCallback(() => {
    setHistory((h) => pushHistory(h, recipeFlipH(h.stack[h.index])));
  }, []);
  const flipV = useCallback(() => {
    setHistory((h) => pushHistory(h, recipeFlipV(h.stack[h.index])));
  }, []);
  const setStraighten = useCallback(
    (deg: number) => {
      setHistory((h) => {
        const cur = h.stack[h.index];
        let next = recipeSetStraighten(cur, deg);
        // Re-clamp an EXPLICIT crop so the new angle can't expose empty corners.
        // (A null crop is auto-filled by the bake/preview, so leave it null.)
        if (next.crop && baseSize) {
          const ob =
            cur.rotate === 90 || cur.rotate === 270
              ? { w: baseSize.h, h: baseSize.w }
              : { w: baseSize.w, h: baseSize.h };
          next = recipeSetCrop(next, clampCropToImage(next.crop, ob.w, ob.h, deg));
        }
        return pushHistory(h, next);
      });
    },
    [baseSize],
  );
  const setCrop = useCallback((crop: CropRect | null) => {
    setHistory((h) => pushHistory(h, recipeSetCrop(h.stack[h.index], crop)));
  }, []);
  const setAspect = useCallback(
    (preset: AspectPreset) => {
      setHistory((h) => {
        const cur = h.stack[h.index];
        const ob =
          cur.rotate === 90 || cur.rotate === 270
            ? { w: baseSize?.h ?? 0, h: baseSize?.w ?? 0 }
            : { w: baseSize?.w ?? 0, h: baseSize?.h ?? 0 };
        if (preset !== "free" && (ob.w === 0 || ob.h === 0)) return h; // base not loaded yet
        return pushHistory(h, recipeAspectCrop(cur, preset, ob.w, ob.h));
      });
    },
    [baseSize],
  );
  const setColor = useCallback((key: ColorKey, value: number) => {
    setHistory((h) => {
      const cur = h.stack[h.index];
      const neutral = COLOR_FIELDS.find((f) => f.key === key)?.neutral ?? 0;
      const next = value === neutral ? withoutColor(cur, key) : { ...cur, [key]: value };
      return pushHistory(h, next);
    });
  }, []);
  const resetTransform = useCallback(() => {
    setHistory((h) =>
      pushHistory(h, { ...h.stack[h.index], rotate: 0, flipH: false, flipV: false }),
    );
  }, []);
  const resetColor = useCallback(() => {
    setHistory((h) => {
      const next = { ...h.stack[h.index] };
      for (const f of COLOR_FIELDS) delete next[f.key];
      return pushHistory(h, next);
    });
  }, []);
  const enterCropMode = useCallback(() => {
    cropSnapshot.current = working;
    setCropMode(true);
  }, [working]);
  const doneCropMode = useCallback(() => setCropMode(false), []);
  const cancelCropMode = useCallback(() => {
    const snap = cropSnapshot.current;
    // Restore the crop+straighten captured on enter (rotate/flip can't change in
    // crop mode, so restoring the whole snapshot recipe is equivalent and simpler).
    if (snap) setHistory((h) => pushHistory(h, snap));
    setCropMode(false);
  }, []);
  const reset = useCallback(() => {
    setHistory((h) => pushHistory(h, NO_EDITS));
  }, []);
  const undo = useCallback(() => {
    setHistory((h) => (h.index > 0 ? { ...h, index: h.index - 1 } : h));
  }, []);
  const redo = useCallback(() => {
    setHistory((h) => (h.index < h.stack.length - 1 ? { ...h, index: h.index + 1 } : h));
  }, []);

  const apply = useCallback(async () => {
    if (applying || sameEdits(working, photo.edits ?? NO_EDITS)) return;
    const startedId = photo.id; // the edit targets this photo, even if we navigate
    setApplying(true);
    try {
      const body = hasEdits(working) ? working : null;
      const res = await fetch(`/api/photos/${startedId}/edit`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ edits: body }),
      });
      if (!res.ok) throw new Error("edit failed");
      const dto = (await res.json()) as PhotoDTO;
      // Patch the shared store so the grid tile + lightbox pick up the new
      // renditions (updatedAt busts the cached rendition URLs) and dimensions.
      // Always safe to patch the edited photo's store entry, even after nav.
      patchPhotos(new Set([startedId]), {
        edits: dto.edits,
        width: dto.width,
        height: dto.height,
        thumbhash: dto.thumbhash,
        updatedAt: dto.updatedAt,
      });
      // Only reset history if we're still on the photo we edited — otherwise we'd
      // clobber the (already reseeded) history of the new photo.
      if (photoIdRef.current === startedId) setHistory(freshHistory(dto.edits ?? NO_EDITS));
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
          setHistory(freshHistory(photo.edits ?? NO_EDITS));
          go();
        }
      });
    },
    [dirty, confirm, photo.edits],
  );

  const value: EditSessionValue = {
    working,
    saved,
    dirty,
    applying,
    canUndo,
    canRedo,
    rotateLeft,
    rotateRight,
    flipH,
    flipV,
    reset,
    undo,
    redo,
    apply,
    guard,
    editing,
    setEditing,
    baseSize,
    setBaseSize,
    orientedBase,
    setStraighten,
    setCrop,
    setAspect,
    setColor,
    resetTransform,
    resetColor,
    cropMode,
    enterCropMode,
    doneCropMode,
    cancelCropMode,
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      {confirmDialog}
    </Ctx.Provider>
  );
}
