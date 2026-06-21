"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Folder as FolderIcon, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { invalidateLibraryTree, useLibraryTree } from "@/components/library-tree/library-tree";
import { buildFolderPickerRows } from "@/lib/library-tree-rows";
import { playSound } from "@/lib/sound/player";
import { SoundEffect } from "@/lib/sound/registry";

const INDENT = 16;

/**
 * The "New album…" path from the photo pickers: create an album from the selected
 * photos and choose which folder to put it in (picking an *existing* album is handled
 * inline by the menu, so this dialog is create-only). Reads the shared folder tree.
 */
export function AddToAlbumDialog({
  open,
  onOpenChange,
  photoIds,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  photoIds: string[];
  /** Called after the album is created and the photos added (close + clear selection). */
  onAdded: () => void;
}) {
  const router = useRouter();
  const { folders } = useLibraryTree();
  const [newName, setNewName] = useState("");
  const [target, setTarget] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setNewName("");
    setTarget(null);
    setError(null);
  }, [open]);

  const rows = buildFolderPickerRows(folders);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const name = newName.trim();
    if (!name || pending) return;
    setPending(true);
    setError(null);
    let albumId: string;
    try {
      const res = await fetch("/api/albums", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, isSmart: false, folderId: target }),
      });
      if (!res.ok) throw new Error();
      albumId = ((await res.json()) as { id: string }).id;
    } catch {
      setError("Failed to create the album.");
      setPending(false);
      return;
    }
    // The album exists now; a failure past this point is an add failure.
    try {
      const res = await fetch(`/api/albums/${albumId}/photos`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ photoIds }),
      });
      if (!res.ok) throw new Error();
      invalidateLibraryTree();
      router.refresh();
      playSound(SoundEffect.ActionComplete);
      onAdded();
    } catch {
      setError("Album created, but adding the photos failed.");
      invalidateLibraryTree();
    } finally {
      setPending(false);
    }
  }

  const photoLabel = `${photoIds.length} ${photoIds.length === 1 ? "photo" : "photos"}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add {photoLabel} to a new album</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => void handleCreate(e)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="new-album-name">Album name</Label>
            <Input
              id="new-album-name"
              autoFocus
              placeholder="New album"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Folder</Label>
            <div className="max-h-56 overflow-y-auto rounded-md border border-border p-1">
              <button
                type="button"
                onClick={() => setTarget(null)}
                className={cn(
                  "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted",
                  target === null && "bg-muted",
                )}
              >
                <Home className="size-4 text-muted-foreground" aria-hidden />
                Top level
              </button>
              {rows.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => setTarget(row.id)}
                  style={{ paddingLeft: 8 + (row.depth + 1) * INDENT }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded py-1.5 pr-2 text-left text-sm hover:bg-muted",
                    target === row.id && "bg-muted",
                  )}
                >
                  <FolderIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="truncate">{row.name}</span>
                </button>
              ))}
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end">
            <Button type="submit" disabled={pending || newName.trim() === ""}>
              {pending ? "Creating…" : "Create album"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
