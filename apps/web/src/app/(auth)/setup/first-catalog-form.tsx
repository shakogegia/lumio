"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FolderBrowserDialog } from "@/components/folder-browser-dialog";

interface CreatedCatalog {
  id: string;
  slug: string;
  name: string;
  path: string;
}

/**
 * Step 2 of first-run setup: point Lumio at a folder of photos. Styled to match
 * {@link SetupForm}. POSTs to `/api/catalogs`; on success it routes into the new
 * catalog, where the worker's reconcile loop indexes photos as they import.
 */
export function FirstCatalogForm({ className }: { className?: string }) {
  const router = useRouter();
  const [name, setName] = useState("My Photos");
  const [path, setPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // The nested folder browser owns its own open state.
  const [browserOpen, setBrowserOpen] = useState(false);

  const disabled = pending || name.trim() === "" || path === null;

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (disabled || path === null) return;
    setError(null);
    setPending(true);
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
          typeof data?.error === "string" ? data.error : "Could not create the catalog.",
        );
        return;
      }
      const data = (await res.json()) as { catalog: CreatedCatalog };
      router.replace(`/c/${data.catalog.slug}/photos`);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <form onSubmit={onSubmit} className={cn("flex flex-col gap-6", className)}>
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-2xl font-semibold">Create your first catalog</h1>
          <p className="text-muted-foreground text-sm text-balance">
            Point Lumio at a folder of photos. You can add more catalogs later.
          </p>
        </div>
        <div className="grid gap-3">
          <div className="grid gap-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              name="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="folder">Folder</Label>
            <div className="flex items-center gap-2">
              <code
                id="folder"
                className={cn(
                  "border-input min-w-0 flex-1 truncate rounded-md border px-3 py-1.5 text-xs",
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
            <p role="alert" className="text-destructive text-sm">
              {error}
            </p>
          )}
          <Button type="submit" className="w-full" disabled={disabled}>
            {pending ? "Creating…" : "Create catalog"}
          </Button>
        </div>
      </form>

      <FolderBrowserDialog
        open={browserOpen}
        onOpenChange={setBrowserOpen}
        onPick={(picked) => setPath(picked)}
        initialPath={path ?? undefined}
      />
    </>
  );
}
