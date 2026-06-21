"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Folder as FolderIcon, Home } from "lucide-react";
import type { FolderDTO } from "@lumio/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/** Build "— — Name" indented labels for a flat folder list, ordered as a tree. */
function flattenTree(folders: FolderDTO[]): { id: string; name: string; depth: number }[] {
  const byParent = new Map<string | null, FolderDTO[]>();
  for (const f of folders) {
    const arr = byParent.get(f.parentId) ?? [];
    arr.push(f);
    byParent.set(f.parentId, arr);
  }
  const out: { id: string; name: string; depth: number }[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const f of (byParent.get(parentId) ?? []).sort((a, b) => a.name.localeCompare(b.name))) {
      out.push({ id: f.id, name: f.name, depth });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export function MoveToFolderDialog({
  open,
  onOpenChange,
  folderIds,
  albumIds,
  onMoved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  folderIds: string[];
  albumIds: string[];
  onMoved: () => void;
}) {
  const router = useRouter();
  const [allFolders, setAllFolders] = useState<FolderDTO[]>([]);
  const [target, setTarget] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTarget(null); // fresh selection each open (don't reuse a stale destination)
    fetch("/api/folders/all")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((d: { items: FolderDTO[] }) => setAllFolders(d.items))
      .catch(() => setAllFolders([]));
  }, [open]);

  // A moved folder cannot be its own destination, and you cannot move it into
  // one of its own descendants. Disable those rows (the server enforces this too).
  const movedSet = useMemo(() => new Set(folderIds), [folderIds]);
  const descendantsOfMoved = useMemo(() => {
    const byParent = new Map<string | null, FolderDTO[]>();
    for (const f of allFolders) {
      const arr = byParent.get(f.parentId) ?? [];
      arr.push(f);
      byParent.set(f.parentId, arr);
    }
    const blocked = new Set<string>(folderIds);
    const stack = [...folderIds];
    while (stack.length) {
      const id = stack.pop() as string;
      for (const c of byParent.get(id) ?? []) {
        if (!blocked.has(c.id)) {
          blocked.add(c.id);
          stack.push(c.id);
        }
      }
    }
    return blocked;
  }, [allFolders, folderIds]);

  const rows = useMemo(() => flattenTree(allFolders), [allFolders]);

  async function handleMove() {
    if (pending) return;
    setPending(true);
    try {
      const res = await fetch("/api/folders/move", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          folderIds: folderIds.length ? folderIds : undefined,
          albumIds: albumIds.length ? albumIds : undefined,
          targetFolderId: target,
        }),
      });
      if (!res.ok) throw new Error("move failed");
      onOpenChange(false);
      onMoved();
      router.refresh();
    } catch {
      toast.error("Failed to move.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Move to…</DialogTitle>
        </DialogHeader>
        <div className="max-h-[320px] overflow-y-auto rounded-md border border-border p-1">
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
          {rows.map((r) => {
            const disabled = movedSet.has(r.id) || descendantsOfMoved.has(r.id);
            return (
              <button
                key={r.id}
                type="button"
                disabled={disabled}
                onClick={() => setTarget(r.id)}
                style={{ paddingLeft: `${8 + r.depth * 16}px` }}
                className={cn(
                  "flex w-full items-center gap-2 rounded py-1.5 pr-2 text-left text-sm hover:bg-muted",
                  target === r.id && "bg-muted",
                  disabled && "cursor-not-allowed opacity-40 hover:bg-transparent",
                )}
              >
                <FolderIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate">{r.name}</span>
              </button>
            );
          })}
        </div>
        <DialogFooter>
          <Button onClick={() => void handleMove()} disabled={pending}>
            {pending ? "Moving…" : "Move here"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
