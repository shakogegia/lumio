"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function RescanButton() {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "running">("idle");

  async function rescan() {
    setState("running");
    await fetch("/api/rescan", { method: "POST" });
    setTimeout(() => {
      setState("idle");
      router.refresh();
    }, 1500);
  }

  return (
    <Button onClick={rescan} disabled={state === "running"}>
      {state === "running" ? "Rescanning…" : "Rescan now"}
    </Button>
  );
}
