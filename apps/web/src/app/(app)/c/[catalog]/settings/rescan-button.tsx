"use client";

import { useRouter } from "next/navigation";
import { JobType } from "@lumio/shared";
import { Button } from "@/components/ui/button";
import { useAsyncJob } from "@/lib/use-async-job";

export function RescanButton() {
  const router = useRouter();
  const { phase, isActive, run } = useAsyncJob(JobType.rescan, "/api/rescan", {
    onComplete: () => router.refresh(),
    toasts: {
      pending: "Rescanning library…",
      success: "Rescan complete",
      error: "Rescan failed. Check the worker logs.",
    },
  });
  const busy = phase === "pending" || isActive;

  return (
    <div className="space-y-1">
      <Button onClick={() => void run()} disabled={busy}>
        {busy ? "Rescanning…" : "Rescan now"}
      </Button>
      {phase === "error" && (
        <p className="text-sm text-destructive">
          Rescan failed. Check the worker logs and try again.
        </p>
      )}
    </div>
  );
}
