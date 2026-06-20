"use client";

import { Logo } from "@/components/logo";
import { activityLabel, isBusy } from "@/lib/activity-display";
import { useActivity } from "@/lib/use-activity";
import { cn } from "@/lib/utils";

/**
 * The sidebar brand mark doubling as the worker activity indicator: the aperture
 * spins while the worker is busy, and a corner dot shows online/offline. The
 * label is exposed via title/aria for hover + screen readers.
 */
export function WorkerActivity() {
  const snapshot = useActivity();
  const busy = isBusy(snapshot);
  const online = snapshot.worker.online;
  const label = activityLabel(snapshot);

  return (
    <span className="relative inline-flex" title={label} aria-label={label}>
      <Logo
        className={cn(
          "h-7 w-7 transition-transform duration-500 ease-out",
          busy ? "animate-spin [animation-duration:2.4s]" : "group-hover:rotate-90",
        )}
      />
      <span
        className={cn(
          "absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ring-2 ring-background transition-colors",
          online ? "bg-emerald-500" : "bg-muted-foreground/40",
        )}
        aria-hidden
      />
    </span>
  );
}
