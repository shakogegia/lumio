"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface RenameTarget {
  id: string;
  name: string;
}

/**
 * Small rename dialog driven by a `catalog` prop: non-null opens it. PATCHes
 * `/api/catalogs/<id>` and calls `onRenamed` on success (the caller refreshes
 * the list). Renaming also re-slugs the catalog server-side, but the management
 * page is slug-agnostic so no navigation is needed here.
 *
 * We retain the last target (`shown`) and bump `openKey` on each open so the
 * form keeps rendering through the close animation instead of blanking the
 * instant `catalog` goes null — yet remounts fresh (reseeded from the name)
 * whenever the dialog is reopened.
 */
export function RenameCatalogDialog({
  catalog,
  onOpenChange,
  onRenamed,
}: {
  catalog: RenameTarget | null;
  onOpenChange: (open: boolean) => void;
  onRenamed: () => void;
}) {
  const [shown, setShown] = useState<RenameTarget | null>(catalog);
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
          <DialogTitle>Rename catalog</DialogTitle>
        </DialogHeader>
        {shown && <RenameForm key={openKey} catalog={shown} onRenamed={onRenamed} />}
      </DialogContent>
    </Dialog>
  );
}

function RenameForm({
  catalog,
  onRenamed,
}: {
  catalog: RenameTarget;
  onRenamed: () => void;
}) {
  const [name, setName] = useState(catalog.name);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const disabled = pending || name.trim() === "";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (disabled) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/catalogs/${catalog.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        setError(
          typeof data?.error === "string" ? data.error : "Failed to rename catalog",
        );
        return;
      }
      onRenamed();
    } catch {
      setError("Failed to rename catalog");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="min-w-0 space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="rename-catalog-name">Name</Label>
        <Input
          id="rename-catalog-name"
          placeholder="Catalog name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <DialogFooter>
        <Button type="submit" disabled={disabled}>
          {pending ? "Saving…" : "Save"}
        </Button>
      </DialogFooter>
    </form>
  );
}
