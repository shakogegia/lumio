"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MatchType, type SmartAlbumRules } from "@lumio/shared";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useCatalog } from "@/components/providers/catalog-context";
import { patchJson } from "@/lib/http";
import { catalogApiUrl } from "@/lib/catalog-api";
import { SmartAlbumRulesEditor, type SmartRulesValue } from "./smart-album-rules-editor";

export function EditRulesDialog({
  albumId,
  initial,
  open,
  onOpenChange,
}: {
  albumId: string;
  initial: SmartAlbumRules | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { slug } = useCatalog();
  const router = useRouter();
  const [value, setValue] = useState<SmartRulesValue>(
    initial
      ? { match: initial.match, rules: initial.rules }
      : { match: MatchType.all, rules: [] },
  );
  const [busy, setBusy] = useState(false);

  async function save() {
    if (value.rules.length === 0 || busy) return;
    setBusy(true);
    try {
      await patchJson(catalogApiUrl(slug, `/albums/${albumId}`), { rules: value });
      toast.success("Rules updated.");
      onOpenChange(false);
      router.refresh();
    } catch {
      toast.error("Failed to update rules.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit smart album rules</DialogTitle>
        </DialogHeader>
        <SmartAlbumRulesEditor value={value} onChange={setValue} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={() => void save()}
            disabled={value.rules.length === 0 || busy}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
