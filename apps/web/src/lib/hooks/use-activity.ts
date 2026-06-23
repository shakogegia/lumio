"use client";

import { useEffect, useRef, useState } from "react";
import type { ActivitySnapshot } from "@lumio/shared";
import { pollInterval } from "@/lib/poll-interval";
import { catalogApiUrl } from "@/lib/catalog-api";
import { useCatalog } from "@/components/providers/catalog-context";

const EMPTY: ActivitySnapshot = { worker: { online: false, activity: "offline" }, jobs: [] };

/**
 * Poll GET /api/activity with an adaptive cadence: fast (~1.5s) while a job is
 * active, slow (~5s) when idle, paused on a hidden tab. This is the single seam
 * to later swap for an SSE/LISTEN-NOTIFY stream without touching consumers.
 */
export function useActivity(): ActivitySnapshot {
  const { slug } = useCatalog();
  const [snapshot, setSnapshot] = useState<ActivitySnapshot>(EMPTY);
  // Keep the latest snapshot in a ref so the scheduler can read it without
  // re-subscribing the effect on every poll. Synced in an effect (not during
  // render) per the refs-in-render rule.
  const latest = useRef(snapshot);
  useEffect(() => {
    latest.current = snapshot;
  });

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;

    const tick = async () => {
      try {
        const res = await fetch(catalogApiUrl(slug, "/activity"), { cache: "no-store" });
        if (!cancelled) {
          if (res.ok) setSnapshot(await res.json());
          else console.warn(`activity returned ${res.status}`);
        }
      } catch {
        // transient — keep the last snapshot, try again next tick
      }
      schedule();
    };

    const schedule = () => {
      if (cancelled) return;
      const hidden = document.hidden;
      const hasActive = latest.current.jobs.length > 0;
      const ms = pollInterval(hasActive, hidden);
      if (ms === null) return; // paused; visibilitychange will restart it
      timer = setTimeout(tick, ms);
    };

    const onVisible = () => {
      if (document.hidden) return;
      if (timer) clearTimeout(timer);
      void tick();
    };

    void tick();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [slug]);

  return snapshot;
}
