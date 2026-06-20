"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { JobType } from "@lumio/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useAsyncJob } from "@/lib/use-async-job";

const CONFIRM_WORD = "DELETE";

function plural(n: number) {
  return n === 1 ? "" : "s";
}

export function DeleteAllPhotos({ photoCount }: { photoCount: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const { phase, isActive, run } = useAsyncJob(JobType.purge_all, "/api/photos/purge", {
    onComplete: () => router.refresh(),
    toasts: {
      pending: "Deleting all photos…",
      success: "All photos deleted",
      error: "Delete failed. Some files may remain.",
    },
  });
  const busy = phase === "pending" || isActive;

  const reset = () => {
    setConfirm("");
  };

  const canDelete = confirm === CONFIRM_WORD && photoCount > 0 && !busy;

  function deleteAll() {
    // Close the dialog immediately; the sidebar aperture shows progress and
    // onComplete refreshes the page once the worker finishes.
    setOpen(false);
    reset();
    void run();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="destructive" disabled={photoCount === 0}>
          Delete all photos
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete all photos?</DialogTitle>
          <DialogDescription>
            This permanently deletes all {photoCount} photo{plural(photoCount)} from the database
            and the filesystem, including the original files and their cached thumbnails. This
            cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="confirm-delete-all">
            Type <span className="font-mono font-semibold">{CONFIRM_WORD}</span> to confirm
          </FieldLabel>
          <Input
            id="confirm-delete-all"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder={CONFIRM_WORD}
          />
          {phase === "error" && (
            <FieldError>
              Something went wrong. Some files may not have been deleted. Try again.
            </FieldError>
          )}
        </Field>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button variant="destructive" disabled={!canDelete} onClick={deleteAll}>
            {busy ? "Deleting…" : `Delete ${photoCount} photo${plural(photoCount)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
