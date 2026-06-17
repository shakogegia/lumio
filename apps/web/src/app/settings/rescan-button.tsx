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
      setTimeout(() => {
        setState("idle");
        router.refresh();
      }, 1500);
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
