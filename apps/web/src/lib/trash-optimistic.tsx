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

  const toastId = toast(`${label} moved to Trash`, {
    duration: 6000,
    // sonner v2 requires a ReactNode for the action slot — use a shadcn Button
    // (same pattern as passkey-nudge.tsx). The button must dismiss the toast
    // explicitly since custom nodes don't auto-dismiss.
    action: (
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          undone = true;
          toast.dismiss(toastId);
          void (async () => {
            try {
              await restorePhotos(slug, ids);
              reload();
            } catch {
              toast.error("Failed to restore photos.");
            }
          })();
        }}
      >
        Undo
      </Button>
    ),
  });

  void (async () => {
    try {
      await trashPhotos(slug, ids);
    } catch {
      if (undone) return; // user already undid; nothing to roll back
      toast.dismiss(toastId);
      toast.error("Failed to move photos to Trash.");
      reload(); // re-sync: the rows were never marked server-side
    }
  })();
}
