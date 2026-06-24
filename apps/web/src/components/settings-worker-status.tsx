"use client";

import Link from "next/link";
import { Activity } from "lucide-react";
import { activityLabel, isBusy } from "@/lib/activity-display";
import { useActivityForSlug } from "@/lib/hooks/use-activity";
import { cn } from "@/lib/utils";

/**
 * Live worker-health pill anchored to the bottom of the settings rail. It does
 * double duty: it gives the rail a footer so the section nav centers the same
 * way the main {@link AppSidebar} does (which has its "More" button there), and
 * it surfaces worker status where an admin manages the system — clicking drills
 * into the Logs view. Unlike the main rail's subtle brand pupil, this is an
 * explicit status widget, so online-and-idle reads green rather than blank. The
 * dot stays neutral until the first poll resolves so it never flashes a state on
 * load. Takes the slug explicitly because the settings shell has no
 * CatalogProvider; worker status is global so any valid catalog works.
 */
export function SettingsWorkerStatus({ slug }: { slug: string | null }) {
  const { snapshot, ready } = useActivityForSlug(slug);
  const online = snapshot.worker.online;
  const busy = online && isBusy(snapshot);
  const label = ready ? activityLabel(snapshot) : "Checking worker…";

  const dot = !ready
    ? "bg-muted-foreground/40"
    : !online
      ? "bg-red-400"
      : busy
        ? "animate-pulse bg-amber-500 dark:bg-amber-400"
        : "bg-emerald-500";

  return (
    <Link
      href="/settings/logs"
      prefetch={false}
      title={label}
      aria-label={label}
      className="group flex w-14 flex-col items-center gap-1 rounded-2xl py-2.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      <span className="relative flex h-[26px] w-[26px] items-center justify-center">
        <Activity
          className="h-[26px] w-[26px] transition-transform duration-200 group-active:scale-90"
          strokeWidth={1.8}
          aria-hidden
        />
        <span
          aria-hidden
          className={cn(
            "absolute -right-1 -top-1 size-2.5 rounded-full ring-2 ring-background",
            dot,
          )}
        />
      </span>
      <span className="text-[10px] font-medium leading-none tracking-wide">Worker</span>
    </Link>
  );
}
