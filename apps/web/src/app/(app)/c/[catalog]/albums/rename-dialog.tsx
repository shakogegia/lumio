"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
import { invalidateLibraryTree } from "@/components/library-tree/library-tree";

/**
 * Controlled rename dialog. `endpoint` is PATCHed with `{ name }`.
 * Used for both folders and albums; the caller passes the catalog-scoped URL
 * (`/api/c/:slug/folders/:id` or `/api/c/:slug/albums/:id`).
 */
export function RenameDialog({
  open,
  onOpenChange,
  endpoint,
  currentName,
  label,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  endpoint: string;
  currentName: string;
  label: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(currentName);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending || name.trim() === "") return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(endpoint, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!res.ok) {
        setError("Failed to rename");
        return;
      }
      onOpenChange(false);
      invalidateLibraryTree();
      router.refresh();
    } catch {
      setError("Failed to rename");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (v) setName(currentName);
        setError(null);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Rename {label}</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="rename-input">Name</Label>
            <Input
              id="rename-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending || name.trim() === ""}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
