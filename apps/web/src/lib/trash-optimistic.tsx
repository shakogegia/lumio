"use client";

import { toast } from "sonner";
import { countLabel } from "@/lib/count-label";
import { restorePhotos, trashPhotos } from "@/lib/photo-mutations";
import { playSound } from "@/lib/sound/player";
import { SoundEffect } from "@/lib/sound/registry";
import { Button } from "@/components/ui/button";

export interface OptimisticTrashArgs {
  slug: string;
  ids: string[];
  /** Drop the tiles immediately (grid handle or collection). */
  removePhotos: (ids: Set<string>) => void;
  /** Re-sync the grid from the server (undo + failure rollback). */
  reload: () => void;
  /** Runs right after the optimistic removal — e.g. clear selection, advance the
   *  lightbox. Not run on undo. */
  onRemoved?: () => void;
}

/**
 * Move photos to Trash optimistically: remove the tiles now, fire the POST in the
 * background, and offer Undo. The POST only marks rows + enqueues the worker, so
 * it's fast; on the rare failure we reload to re-sync. Undo restores (dual-state)
 * and reloads. Shared by the grid (usePhotoActions) and the lightbox.
 */
export function optimisticTrash({ slug, ids, removePhotos, reload, onRemoved }: OptimisticTrashArgs): void {
  if (ids.length === 0) return;
  removePhotos(new Set(ids));
  playSound(SoundEffect.MoveToTrash);
  onRemoved?.();

  let undone = false;
  const label = countLabel(ids.length, "photo", "photos");

  // Fire the trash POST in the background; keep the promise so Undo can wait for it.
  const trashed = trashPhotos(slug, ids);

  // toastId is captured by the Undo handler, which only runs on click — after the
  // assignment below, so the forward reference is safe.
  let toastId: string | number = "";
  const handleUndo = () => {
    undone = true;
    toast.dismiss(toastId);
    void (async () => {
      // Wait for the trash POST to settle first, so restore can't run before the
      // mark is applied (which would otherwise let the photo get trashed anyway).
      // A trash failure is fine here — there's then nothing to undo.
      try {
        await trashed;
      } catch {
        /* trash never applied; restore below is a harmless no-op */
      }
      try {
        await restorePhotos(slug, ids);
        reload();
      } catch {
        toast.error("Failed to restore photos.");
      }
    })();
  };

  // Render our own row so the message sits left and Undo sits at the end
  // (space-between), rather than relying on sonner's action-slot placement.
  toastId = toast(
    <div className="flex w-full items-center justify-between gap-3">
      <span className="min-w-0 truncate">{label} moved to Trash</span>
      <Button size="sm" variant="outline" className="shrink-0" onClick={handleUndo}>
        Undo
      </Button>
    </div>,
    // `content: flex-1` makes sonner's content slot fill the toast width (it
    // shrinks to its content by default), so our row's justify-between can push
    // Undo to the end.
    { duration: 6000, closeButton: true, classNames: { content: "flex-1" } },
  );

  void trashed.catch(() => {
    if (undone) return; // user already undid; nothing to roll back
    toast.dismiss(toastId);
    toast.error("Failed to move photos to Trash.");
    reload(); // re-sync: the rows were never marked server-side
  });
}
