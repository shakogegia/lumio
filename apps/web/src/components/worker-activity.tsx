"use client";

import { Logo } from "@/components/logo";
import { activityLabel, isBusy } from "@/lib/activity-display";
import { useActivity } from "@/lib/use-activity";
import { cn } from "@/lib/utils";

// The aperture's iris opening is a hexagon (not a circle). The status "pupil"
// sits in its exact centre, clipped to that shape rather than a round dot.
const IRIS_CLIP = "polygon(50% 3%, 93% 27%, 93% 73%, 50% 97%, 7% 73%, 7% 27%)";

/**
 * The sidebar brand mark doubling as the worker activity indicator: a pupil in
 * the aperture's centre reflects worker state — amber and pulsing while busy
 * (the same amber the upload UI uses for "Duplicate"), steady green when
 * idle/online, red when offline. The full label is exposed via title/aria for
 * hover + screen readers.
 */
export function WorkerActivity() {
  const snapshot = useActivity();
  const online = snapshot.worker.online;
  const busy = online && isBusy(snapshot);
  const label = activityLabel(snapshot);

  const pupil = !online
    ? "bg-destructive"
    : busy
      ? "animate-pulse bg-amber-600 dark:bg-amber-400"
      : "bg-green-600 dark:bg-green-500";

  return (
    <span
      className="relative inline-flex transition-transform duration-500 ease-out group-hover:rotate-90"
      title={label}
      aria-label={label}
    >
      <Logo className="h-7 w-7" />
      <span
        aria-hidden
        className={cn(
          "absolute left-1/2 top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 transition-colors",
          pupil,
        )}
        style={{ clipPath: IRIS_CLIP }}
      />
    </span>
  );
}
