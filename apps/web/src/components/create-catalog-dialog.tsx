"use client";

import { useState } from "react";
import { FolderOpen } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { FolderBrowserDialog } from "@/components/folder-browser-dialog";

interface CreatedCatalog {
  id: string;
  slug: string;
  name: string;
  path: string;
}

/**
 * Pairs a name field with the {@link FolderBrowserDialog} and POSTs to
 * `/api/catalogs`. Catalog-agnostic: it does NOT read `useCatalog()` so it can
 * be used from first-run setup, the catalog switcher, and the `/catalogs`
 * manager. `onCreated` is the seam those callers hook into.
 */
export function CreateCatalogDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fired once the catalog is created (201). */
  onCreated: (catalog: CreatedCatalog) => void;
}) {
  const [name, setName] = useState("");
  const [path, setPath] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The nested folder browser owns its own open state.
  const [browserOpen, setBrowserOpen] = useState(false);

  const disabled = pending || name.trim() === "" || path === null;

  function reset() {
    setName("");
    setPath(null);
    setError(null);
  }

  function handleOpenChange(value: boolean) {
    onOpenChange(value);
    if (!value) reset();
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (disabled || path === null) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch("/api/catalogs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), path }),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        setError(
          typeof data?.error === "string" ? data.error : "Failed to create catalog",
        );
        return;
      }

      const data = (await res.json()) as { catalog: CreatedCatalog };
      onCreated(data.catalog);
      onOpenChange(false);
      reset();
    } catch {
      setError("Failed to create catalog");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New catalog</DialogTitle>
          </DialogHeader>
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="catalog-name">Name</Label>
              <Input
                id="catalog-name"
                placeholder="Catalog name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="catalog-folder">Folder</Label>
              <div className="flex items-center gap-2">
                <code
                  id="catalog-folder"
                  className={cn(
                    "min-w-0 flex-1 truncate rounded-md border border-input px-3 py-1.5 text-xs",
                    path ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {path ?? "No folder selected"}
                </code>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setBrowserOpen(true)}
                >
                  <FolderOpen />
                  Browse…
                </Button>
              </div>
            </div>

            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}

            <DialogFooter>
              <Button type="submit" disabled={disabled}>
                {pending ? "Creating…" : "Create catalog"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <FolderBrowserDialog
        open={browserOpen}
        onOpenChange={setBrowserOpen}
        onPick={(picked) => setPath(picked)}
        initialPath={path ?? undefined}
      />
    </>
  );
}
