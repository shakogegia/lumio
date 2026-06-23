"use client";

import { useEffect, useState } from "react";
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
import { FolderBrowser } from "@/components/directory-picker";
import { apiPaths } from "@/lib/api-paths";

interface CreatedCatalog {
  id: string;
  slug: string;
  name: string;
  path: string;
}

/**
 * Pairs a name field with an inline {@link FolderBrowser} and POSTs to
 * `/api/catalogs`. The dialog swaps between the form and the browser in place
 * (no nested modal), so Cancelling the browse returns to the form without
 * closing the whole dialog. Catalog-agnostic: it does NOT read `useCatalog()`
 * so it can be used from first-run setup, the catalog switcher, and the
 * `/catalogs` manager. `onCreated` is the seam those callers hook into.
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
  // Whether the inline folder browser is showing instead of the form.
  const [browsing, setBrowsing] = useState(false);

  // Reset the form when the dialog OPENS (not when it closes) so the content
  // stays intact through the close/exit animation instead of blanking out
  // mid-transition.
  useEffect(() => {
    if (!open) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setName("");
    setPath(null);
    setError(null);
    setBrowsing(false);
  }, [open]);

  const disabled = pending || name.trim() === "" || path === null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (disabled || path === null) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(apiPaths.catalogs, {
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
    } catch {
      setError("Failed to create catalog");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{browsing ? "Choose a folder" : "New catalog"}</DialogTitle>
        </DialogHeader>

        {browsing ? (
          <FolderBrowser
            initialPath={path ?? undefined}
            onPick={(picked) => {
              setPath(picked);
              setBrowsing(false);
            }}
            onCancel={() => setBrowsing(false)}
          />
        ) : (
          <form
            onSubmit={(e) => void handleSubmit(e)}
            className="min-w-0 space-y-4"
          >
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
              <div className="flex min-w-0 items-center gap-2">
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
                  onClick={() => setBrowsing(true)}
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
        )}
      </DialogContent>
    </Dialog>
  );
}
