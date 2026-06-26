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
import { invalidateLibraryTree } from "@/components/library-tree/library-tree";
import { catalogApiUrl } from "@/lib/catalog-api";
import { useCatalog } from "@/components/providers/catalog-context";
import {
  SmartAlbumRulesEditor,
  rulesComplete,
  type SmartRulesValue,
} from "./smart-album-rules-editor";

/**
 * Create an album. `smart` makes it a dedicated smart-album dialog: the metadata
 * rule builder is shown directly (no toggle, no card wrapper) and the album is
 * created with its rules. "New album" and "New smart album" are two menu items
 * sharing this one dialog + the reusable SmartAlbumRulesEditor.
 */
export function NewAlbumDialog({
  folderId = null,
  smart = false,
  open,
  onOpenChange,
}: {
  folderId?: string | null;
  smart?: boolean;
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
} = {}) {
  const router = useRouter();
  const { slug } = useCatalog();
  const controlled = open !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const isOpen = controlled ? open : internalOpen;
  const [name, setName] = useState("");
  const [smartRules, setSmartRules] = useState<SmartRulesValue>({
    match: MatchType.all,
    rules: [],
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prevOpen, setPrevOpen] = useState(isOpen);

  const title = smart ? "New smart album" : "New album";

  function reset() {
    setName("");
    setSmartRules({ match: MatchType.all, rules: [] });
    setError(null);
  }

  // Reset to a fresh form when the dialog OPENS — not on close — so the content
  // doesn't blank out mid close-animation.
  if (isOpen !== prevOpen) {
    setPrevOpen(isOpen);
    if (isOpen) reset();
  }

  const disabled =
    pending || name.trim() === "" || (smart && !rulesComplete(smartRules.rules));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (disabled) return;
    setPending(true);
    setError(null);
    try {
      const body = smart
        ? { name: name.trim(), isSmart: true, folderId, rules: smartRules }
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
  }

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      {!controlled && (
        <DialogTrigger asChild>
          <Button size="sm">{title}</Button>
        </DialogTrigger>
      )}
      <DialogContent
        className={smart ? "sm:max-w-2xl" : "sm:max-w-md"}
        // Never close on an outside click — it's far too easy to dismiss by
        // accident (especially while a Select/Popover dropdown is open, where the
        // click is really dismissing the dropdown). Close via the X / Cancel / Esc.
        onInteractOutside={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
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

          {smart && (
            <SmartAlbumRulesEditor value={smartRules} onChange={setSmartRules} />
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
