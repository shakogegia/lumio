"use client";

import { useEffect, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { apiPaths } from "@/lib/api-paths";

interface DeleteTarget {
  id: string;
  name: string;
}

type DeleteMode = "detach" | "delete-originals";

/**
 * Two-mode delete prompt for a catalog, in two steps:
 *  1. Choose Detach (safe — leaves the original files on disk) or Delete
 *     originals (also erases the photo files).
 *  2. An explicit confirmation of that choice before anything happens.
 * Both submit to `DELETE /api/catalogs/<id>?mode=…`; `onDeleted` fires on success
 * (the caller refreshes the list). Driven by a `catalog` prop (non-null = open).
 *
 * We retain the last target (`shown`) and bump `openKey` on each open so the
 * body keeps rendering through the close animation instead of blanking the
 * instant `catalog` goes null — yet remounts fresh (back at step 1) on reopen.
 */
export function DeleteCatalogDialog({
  catalog,
  onOpenChange,
  onDeleted,
}: {
  catalog: DeleteTarget | null;
  onOpenChange: (open: boolean) => void;
  onDeleted: () => void;
}) {
  const [shown, setShown] = useState<DeleteTarget | null>(catalog);
  const [openKey, setOpenKey] = useState(0);

  useEffect(() => {
    if (!catalog) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setShown(catalog);
    setOpenKey((k) => k + 1);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [catalog]);

  return (
    <Dialog open={catalog !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete {shown?.name ?? "catalog"}?</DialogTitle>
          <DialogDescription>
            Choose what happens to the original photo files. The catalog and its
            Lumio data (albums, edits, trash) are removed either way.
          </DialogDescription>
        </DialogHeader>
        {shown && <DeleteBody key={openKey} catalog={shown} onDeleted={onDeleted} />}
      </DialogContent>
    </Dialog>
  );
}

function DeleteBody({
  catalog,
  onDeleted,
}: {
  catalog: DeleteTarget;
  onDeleted: () => void;
}) {
  const [confirming, setConfirming] = useState<DeleteMode | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete(mode: DeleteMode) {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`${apiPaths.catalog(catalog.id)}?mode=${mode}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        setError(
          typeof data?.error === "string" ? data.error : "Failed to delete catalog",
        );
        return;
      }
      onDeleted();
    } catch {
      setError("Failed to delete catalog");
    } finally {
      setPending(false);
    }
  }

  // Step 2 — confirm the chosen action.
  if (confirming) {
    const destructive = confirming === "delete-originals";
    return (
      <div className="space-y-4">
        <div
          className={cn(
            "rounded-xl border p-3.5",
            destructive ? "border-destructive/40 bg-destructive/5" : "border-border",
          )}
        >
          <p
            className={cn(
              "text-sm font-medium",
              destructive ? "text-destructive" : "text-foreground",
            )}
          >
            {destructive
              ? `Permanently delete “${catalog.name}” and its photo files?`
              : `Detach “${catalog.name}”?`}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {destructive
              ? "The catalog and the original photo files on disk are deleted for good. This cannot be undone."
              : "The catalog and its Lumio data are removed. The original photo files stay on disk — you can re-add the folder later."}
          </p>
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        <DialogFooter className="sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              setConfirming(null);
              setError(null);
            }}
          >
            <ChevronLeft />
            Back
          </Button>
          <Button
            type="button"
            variant={destructive ? "destructive" : "default"}
            disabled={pending}
            onClick={() => void handleDelete(confirming)}
          >
            {pending
              ? destructive
                ? "Deleting…"
                : "Detaching…"
              : destructive
                ? "Delete permanently"
                : "Detach catalog"}
          </Button>
        </DialogFooter>
      </div>
    );
  }

  // Step 1 — pick what happens to the originals.
  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => setConfirming("detach")}
        className="block w-full rounded-xl border border-border p-3.5 text-left transition-colors hover:bg-muted"
      >
        <p className="text-sm font-medium text-foreground">
          Detach <span className="font-normal text-muted-foreground">(recommended)</span>
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Removes the catalog from Lumio but leaves the original photo files on
          disk untouched. You can re-add the folder later.
        </p>
      </button>

      <button
        type="button"
        onClick={() => setConfirming("delete-originals")}
        className="block w-full rounded-xl border border-destructive/40 bg-destructive/5 p-3.5 text-left transition-colors hover:bg-destructive/10"
      >
        <p className="text-sm font-medium text-destructive">Delete originals</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Also permanently deletes the photo files from disk. This cannot be
          undone.
        </p>
      </button>
    </div>
  );
}
