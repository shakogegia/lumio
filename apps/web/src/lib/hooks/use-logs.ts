"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LOGS_PAGE_SIZE, type LogLevel, type LogsResponse, type WorkerLogEntry } from "@lumio/shared";
import { pollInterval } from "@/lib/poll-interval";

export type SinceFilter = "1h" | "24h" | "7d";

const SINCE_MS: Record<SinceFilter, number> = {
  "1h": 3_600_000,
  "24h": 86_400_000,
  "7d": 604_800_000,
};

export interface UseLogsResult {
  entries: WorkerLogEntry[];
  loading: boolean;
  hasMore: boolean;
  loadMore: () => void;
}

function buildUrl(levels: LogLevel[], sinceIso: string, before?: string): string {
  const params = new URLSearchParams();
  if (levels.length > 0) params.set("level", levels.join(","));
  params.set("since", sinceIso);
  params.set("limit", String(LOGS_PAGE_SIZE));
  if (before) params.set("before", before);
  return `/api/logs?${params.toString()}`;
}

function sortDesc(entries: WorkerLogEntry[]): WorkerLogEntry[] {
  return [...entries].sort((a, b) =>
    a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0,
  );
}

/**
 * Fetch worker logs with the existing adaptive poll cadence. Resets and
 * live-polls the newest page whenever the filters change, dedupes by id, and
 * exposes `loadMore` to append older pages. Filters are tracked via the
 * comma-joined `levelKey` so a fresh `levels` array identity each render does
 * not thrash the effect.
 */
export function useLogs(levels: LogLevel[], since: SinceFilter): UseLogsResult {
  const [entries, setEntries] = useState<WorkerLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);

  const levelKey = levels.join(",");
  const filterKey = `${levelKey}|${since}`;

  // Reset when the filters change. This is React's "adjust state during render"
  // pattern (guarded so it runs once per change) — NOT a setState inside an
  // effect, which the React Compiler lint forbids.
  const [prevFilter, setPrevFilter] = useState(filterKey);
  if (filterKey !== prevFilter) {
    setPrevFilter(filterKey);
    setEntries([]);
    setLoading(true);
    setHasMore(false);
  }

  // Latest entries for loadMore's cursor; synced in an effect, not during render.
  const entriesRef = useRef(entries);
  useEffect(() => {
    entriesRef.current = entries;
  });

  const mergeInto = useCallback((incoming: WorkerLogEntry[]) => {
    setEntries((prev) => {
      const map = new Map(prev.map((e) => [e.id, e] as const));
      for (const e of incoming) map.set(e.id, e);
      return sortDesc([...map.values()]);
    });
  }, []);

  // Reset on filter change, then live-poll the newest page.
  useEffect(() => {
    const activeLevels = levelKey ? (levelKey.split(",") as LogLevel[]) : [];
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const sinceIso = () => new Date(Date.now() - SINCE_MS[since]).toISOString();

    const tick = async () => {
      try {
        const res = await fetch(buildUrl(activeLevels, sinceIso()), { cache: "no-store" });
        if (res.ok && !cancelled) {
          const data: LogsResponse = await res.json();
          mergeInto(data.entries);
          if (data.entries.length >= LOGS_PAGE_SIZE) setHasMore(true);
        }
      } catch {
        // transient — keep the last entries, retry next tick
      }
      if (!cancelled) setLoading(false);
      schedule();
    };

    const schedule = () => {
      if (cancelled) return;
      const ms = pollInterval(false, document.hidden);
      if (ms === null) return; // paused on hidden tab; visibilitychange restarts
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
  }, [levelKey, since, mergeInto]);

  const loadMore = useCallback(() => {
    const current = entriesRef.current;
    const oldest = current[current.length - 1];
    if (!oldest) return;
    const activeLevels = levelKey ? (levelKey.split(",") as LogLevel[]) : [];
    const sinceIso = new Date(Date.now() - SINCE_MS[since]).toISOString();
    void (async () => {
      try {
        const res = await fetch(buildUrl(activeLevels, sinceIso, oldest.createdAt), { cache: "no-store" });
        if (!res.ok) return;
        const data: LogsResponse = await res.json();
        mergeInto(data.entries);
        setHasMore(data.entries.length >= LOGS_PAGE_SIZE);
      } catch {
        // ignore — the button stays available to retry
      }
    })();
  }, [levelKey, since, mergeInto]);

  return { entries, loading, hasMore, loadMore };
}
