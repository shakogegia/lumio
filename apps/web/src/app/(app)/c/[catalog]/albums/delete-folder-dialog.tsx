"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Asks how to delete one or more non-empty folders. Resolves via `onChoose`:
 * "reparent" (keep albums/sub-folders, move them up) or "cascade" (delete them
 * too). Closing/Cancel = abort (no call to onChoose).
 */
export function DeleteFolderDialog({
  open,
  onOpenChange,
  count,
  pending,
  onChoose,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  count: number;
  pending: boolean;
  onChoose: (mode: "reparent" | "cascade") => void;
}) {
  const label = count === 1 ? "this folder" : `these ${count} folders`;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete {label}?</DialogTitle>
          <DialogDescription>
            Your photos always stay in your library. Choose what happens to the albums and
            sub-folders inside.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button variant="ghost" disabled={pending} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" disabled={pending} onClick={() => onChoose("reparent")}>
              Keep contents
            </Button>
            <Button variant="destructive" disabled={pending} onClick={() => onChoose("cascade")}>
              Delete contents
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
