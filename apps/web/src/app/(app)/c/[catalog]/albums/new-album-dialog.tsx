"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MatchType } from "@lumio/shared";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { invalidateLibraryTree } from "@/components/library-tree/library-tree";
import { catalogApiUrl } from "@/lib/catalog-api";
import { useCatalog } from "@/components/providers/catalog-context";
import {
  SmartAlbumRulesEditor,
  type SmartRulesValue,
} from "./smart-album-rules-editor";

export function NewAlbumDialog({
  folderId = null,
  open,
  onOpenChange,
}: {
  folderId?: string | null;
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
} = {}) {
  const router = useRouter();
  const { slug } = useCatalog();
  const controlled = open !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = controlled ? open : internalOpen;
  const [name, setName] = useState("");
  const [isSmart, setIsSmart] = useState(false);
  const [smart, setSmart] = useState<SmartRulesValue>({
    match: MatchType.all,
    rules: [],
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setIsSmart(false);
    setSmart({ match: MatchType.all, rules: [] });
    setError(null);
  }

  const disabled =
    pending ||
    name.trim() === "" ||
    (isSmart && smart.rules.length === 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (disabled) return;
    setPending(true);
    setError(null);
    try {
      const body = isSmart
        ? {
            name: name.trim(),
            isSmart: true,
            folderId,
            rules: smart,
          }
        : { name: name.trim(), isSmart: false, folderId };

      const res = await fetch(catalogApiUrl(slug, "/albums"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string }
          | null;
        setError(
          typeof data?.error === "string" ? data.error : "Failed to create album",
        );
        return;
      }

      handleOpenChange(false);
      invalidateLibraryTree();
      router.refresh();
    } catch {
      setError("Failed to create album");
    } finally {
      setPending(false);
    }
  }

  function handleOpenChange(value: boolean) {
    if (controlled) onOpenChange?.(value);
    else setInternalOpen(value);
    if (!value) reset();
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      {!controlled && (
        <DialogTrigger asChild>
          <Button size="sm">New album</Button>
        </DialogTrigger>
      )}
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New album</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="album-name">Name</Label>
            <Input
              id="album-name"
              placeholder="Album name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>

          <div className="flex items-center gap-3">
            <Switch
              id="is-smart"
              checked={isSmart}
              onCheckedChange={(val) => {
                setIsSmart(val);
                if (!val) setSmart({ match: MatchType.all, rules: [] });
              }}
            />
            <Label htmlFor="is-smart">Smart album</Label>
          </div>

          {isSmart && (
            <div className="rounded-lg border border-border p-3">
              <SmartAlbumRulesEditor value={smart} onChange={setSmart} />
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="submit" disabled={disabled}>
              {pending ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
