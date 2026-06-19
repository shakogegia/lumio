"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/confirm-dialog";

/** Moves a single photo to Trash from the detail view, then returns to the grid. */
export function DeletePhotoButton({ photoId }: { photoId: string }) {
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const [pending, setPending] = useState(false);

  async function handleDelete() {
    const ok = await confirm({
      title: "Move to Trash?",
      description: "This photo will be moved to Trash. You can restore it later.",
      confirmLabel: "Move to Trash",
      destructive: true,
    });
    if (!ok) return;
    setPending(true);
    try {
      const res = await fetch("/api/photos/trash", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: [photoId] }),
      });
      if (!res.ok) throw new Error("trash failed");
      // No setPending(false) on success: we navigate away and unmount, and the
      // disabled button avoids a double-fire during the transition.
      router.back();
    } catch {
      toast.error("Failed to move photo to Trash.");
      setPending(false);
    }
  }

  return (
    <>
      {confirmDialog}
      <Button
        variant="destructive"
        size="sm"
        className="w-full"
        disabled={pending}
        onClick={() => void handleDelete()}
      >
        <Trash2 aria-hidden />
        {pending ? "Deleting…" : "Move to Trash"}
      </Button>
    </>
  );
}
