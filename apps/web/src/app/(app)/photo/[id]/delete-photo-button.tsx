"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/** Moves a single photo to Trash from the detail view, then returns to the grid. */
export function DeletePhotoButton({ photoId }: { photoId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleDelete() {
    if (!confirm("Move this photo to Trash?")) return;
    setPending(true);
    try {
      const res = await fetch("/api/photos/trash", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: [photoId] }),
      });
      if (!res.ok) throw new Error("trash failed");
      router.back();
    } catch {
      toast.error("Failed to move photo to Trash.");
      setPending(false);
    }
  }

  return (
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
  );
}
