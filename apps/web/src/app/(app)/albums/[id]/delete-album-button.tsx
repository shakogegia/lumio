"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/confirm-dialog";

export function DeleteAlbumButton({ albumId }: { albumId: string }) {
  const router = useRouter();
  const { confirm, confirmDialog } = useConfirm();
  const [pending, setPending] = useState(false);

  async function handleDelete() {
    const ok = await confirm({
      title: "Delete album?",
      description: "This can't be undone. The photos stay in your library.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    setPending(true);
    try {
      const res = await fetch(`/api/albums/${albumId}`, { method: "DELETE" });
      if (res.ok) {
        router.push("/albums");
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      {confirmDialog}
      <Button
        variant="destructive"
        size="sm"
        disabled={pending}
        onClick={() => void handleDelete()}
      >
        {pending ? "Deleting…" : "Delete"}
      </Button>
    </>
  );
}
