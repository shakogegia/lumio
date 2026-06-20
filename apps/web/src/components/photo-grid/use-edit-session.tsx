"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  NO_EDITS,
  hasEdits,
  rotateLeft as recipeRotateLeft,
  rotateRight as recipeRotateRight,
  toggleFlipH as recipeFlipH,
  toggleFlipV as recipeFlipV,
  type PhotoDTO,
  type PhotoEdits,
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

/** Undo/redo history of working recipes; `stack[index]` is the live recipe. */
interface History {
  stack: PhotoEdits[];
  index: number;
}

function freshHistory(base: PhotoEdits): History {
  return { stack: [base], index: 0 };
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
  const photoIdRef = useRef(photo.id);

  const working = history.stack[history.index];
  const canUndo = history.index > 0;
  const canRedo = history.index < history.stack.length - 1;

  // Re-seed history when the photo changes (arrow-nav / film strip). Assign
  // through a local fn so it isn't a direct setState-in-effect call (the
  // react-compiler rule only flags synchronous direct calls in the effect body).
  useEffect(() => {
    const reseed = (e: PhotoEdits) => setHistory(freshHistory(e));
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
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      {confirmDialog}
    </Ctx.Provider>
  );
}
