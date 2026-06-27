"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { JobType } from "@lumio/shared";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Label } from "@/components/ui/label";
import { useAsyncJob } from "@/lib/hooks/use-async-job";
import { catalogApiUrl } from "@/lib/catalog-api";
import { useCatalog } from "@/components/providers/catalog-context";

const CONFIRM_WORD = "REORGANIZE";

export function ReorganizePhotos() {
  const router = useRouter();
  const { slug } = useCatalog();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [includeFilesystem, setIncludeFilesystem] = useState(false);
  const [preview, setPreview] = useState<{ total: number; willMove: number } | null>(null);

  const query = `?includeFilesystem=${includeFilesystem}`;
  const jobType = includeFilesystem ? JobType.reorganize_all : JobType.reorganize;
  const { phase, isActive, run } = useAsyncJob(
    jobType,
    catalogApiUrl(slug, `/photos/reorganize${query}`),
    {
      onComplete: () => router.refresh(),
      toasts: {
        pending: "Reorganizing files…",
        success: "Files reorganized",
        error: "Reorganize failed. Some files may not have moved.",
      },
    },
  );
  const busy = phase === "pending" || isActive;

  // Fetch the preview count whenever the dialog is open and the scope changes.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreview(null);
    fetch(catalogApiUrl(slug, `/photos/reorganize/preview${query}`))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((data: { total: number; willMove: number }) => {
        if (!cancelled) setPreview(data);
      })
      .catch(() => {
        if (!cancelled) setPreview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, slug, query]);

  const canRun = confirm === CONFIRM_WORD && (preview?.willMove ?? 0) > 0 && !busy;

  function start() {
    setOpen(false);
    setConfirm("");
    void run();
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setConfirm("");
      }}
    >
      <DialogTrigger asChild>
        <Button variant="destructive">Reorganize files</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reorganize files by upload template?</DialogTitle>
          <DialogDescription>
            Moves photos on disk into the folders your current upload template produces.
            Photo edits and metadata are preserved. The on-disk layout change cannot be undone.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Checkbox
            id="include-filesystem"
            checked={includeFilesystem}
            disabled={busy}
            onCheckedChange={(v) => setIncludeFilesystem(v === true)}
          />
          <Label htmlFor="include-filesystem">Include filesystem-imported photos</Label>
        </div>

        <p className="text-sm text-muted-foreground tabular-nums">
          {preview === null
            ? "Calculating…"
            : `${preview.willMove} of ${preview.total} photos will be relocated.`}
        </p>

        <Field>
          <FieldLabel htmlFor="confirm-reorganize">
            Type <span className="font-mono font-semibold">{CONFIRM_WORD}</span> to confirm
          </FieldLabel>
          <Input
            id="confirm-reorganize"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder={CONFIRM_WORD}
          />
          {phase === "error" && (
            <FieldError>Something went wrong. Some files may not have moved. Try again.</FieldError>
          )}
        </Field>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button variant="destructive" disabled={!canRun} onClick={start}>
            {busy ? "Reorganizing…" : "Reorganize"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
