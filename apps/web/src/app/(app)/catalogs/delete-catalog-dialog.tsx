"use client";

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
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

interface DeleteTarget {
  id: string;
  name: string;
}

type DeleteMode = "detach" | "delete-originals";

/**
 * Two-mode delete prompt for a catalog:
 *  - Detach (default, safe): removes the catalog and its Lumio data but leaves
 *    the original files on disk.
 *  - Delete originals (destructive): also erases the photo files from disk —
 *    gated behind an explicit "I understand" checkbox so it can't be a misclick.
 * Both submit to `DELETE /api/catalogs/<id>?mode=…`; `onDeleted` fires on success
 * (the caller refreshes the list). Driven by a `catalog` prop (non-null = open).
 *
 * The body lives in a child keyed by catalog id so its confirmation/error state
 * starts fresh whenever a different catalog is targeted — no resetting effect.
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
  return (
    <Dialog open={catalog !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete {catalog?.name ?? "catalog"}?</DialogTitle>
          <DialogDescription>
            Choose what happens to the original photo files. The catalog and its
            Lumio data (albums, edits, trash) are removed either way.
          </DialogDescription>
        </DialogHeader>
        {catalog && (
          <DeleteBody key={catalog.id} catalog={catalog} onDeleted={onDeleted} />
        )}
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
  const [confirmOriginals, setConfirmOriginals] = useState(false);
  const [pending, setPending] = useState<DeleteMode | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete(mode: DeleteMode) {
    if (pending) return;
    setPending(mode);
    setError(null);
    try {
      const res = await fetch(`/api/catalogs/${catalog.id}?mode=${mode}`, {
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
      setPending(null);
    }
  }

  const busy = pending !== null;

  return (
    <div className="space-y-4">
      <div className="space-y-4">
        <div className="rounded-xl border border-border p-3.5">
          <p className="text-sm font-medium text-foreground">
            Detach (recommended)
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Removes the catalog from Lumio but leaves the original photo files on
            disk untouched. You can re-add the folder later.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3"
            disabled={busy}
            onClick={() => void handleDelete("detach")}
          >
            {pending === "detach" ? "Detaching…" : "Detach catalog"}
          </Button>
        </div>

        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-3.5">
          <p className="text-sm font-medium text-destructive">Delete originals</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Also permanently deletes the photo files from disk. This cannot be
            undone.
          </p>
          <label className="mt-3 flex items-start gap-2.5 text-sm text-foreground">
            <input
              type="checkbox"
              checked={confirmOriginals}
              onChange={(e) => setConfirmOriginals(e.target.checked)}
              className={cn(
                "mt-0.5 size-4 shrink-0 cursor-pointer rounded border-input",
                "accent-destructive",
              )}
            />
            I understand the photo files will be permanently deleted.
          </label>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="mt-3"
            disabled={busy || !confirmOriginals}
            onClick={() => void handleDelete("delete-originals")}
          >
            {pending === "delete-originals"
              ? "Deleting…"
              : "Delete catalog & originals"}
          </Button>
        </div>

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>

      <DialogFooter>
        <DialogClose asChild>
          <Button variant="ghost" disabled={busy}>
            Cancel
          </Button>
        </DialogClose>
      </DialogFooter>
    </div>
  );
}
