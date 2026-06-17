"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function DeleteAlbumButton({ albumId }: { albumId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleDelete() {
    if (!confirm("Delete this album? This cannot be undone.")) return;
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
    <Button
      variant="destructive"
      size="sm"
      disabled={pending}
      onClick={() => void handleDelete()}
    >
      {pending ? "Deleting…" : "Delete"}
    </Button>
  );
}
