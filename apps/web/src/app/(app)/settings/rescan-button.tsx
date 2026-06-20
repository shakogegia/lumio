"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function RescanButton() {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "running" | "error">("idle");

  async function rescan() {
    setState("running");
    try {
      const res = await fetch("/api/rescan", { method: "POST" });
      if (!res.ok) throw new Error(`Rescan failed: ${res.status}`);
      // The worker now owns progress (watch the sidebar aperture). Re-enable the
      // button shortly; the catalog refreshes as rows land.
      setTimeout(() => {
        setState("idle");
        router.refresh();
      }, 1000);
    } catch {
      setState("error");
    }
  }

  return (
    <div className="space-y-1">
      <Button onClick={rescan} disabled={state === "running"}>
        {state === "running" ? "Rescanning…" : "Rescan now"}
      </Button>
      {state === "error" && (
        <p className="text-sm text-destructive">Rescan failed. Check the worker logs and try again.</p>
      )}
    </div>
  );
}
