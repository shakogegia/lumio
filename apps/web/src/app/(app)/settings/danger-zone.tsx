"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
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

const CONFIRM_WORD = "DELETE";

function plural(n: number) {
  return n === 1 ? "" : "s";
}

export function DeleteAllPhotos({ photoCount }: { photoCount: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [state, setState] = useState<"idle" | "deleting" | "error">("idle");

  const reset = () => {
    setConfirm("");
    setState("idle");
  };

  const canDelete = confirm === CONFIRM_WORD && photoCount > 0 && state !== "deleting";

  async function deleteAll() {
    setState("deleting");
    try {
      const res = await fetch("/api/photos/purge", { method: "POST" });
      if (!res.ok) throw new Error(`Delete failed: ${res.status}`);
      setOpen(false);
      reset();
      router.refresh();
    } catch {
      setState("error");
    }
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
          {state === "error" && (
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
            {state === "deleting"
              ? "Deleting…"
              : `Delete ${photoCount} photo${plural(photoCount)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
