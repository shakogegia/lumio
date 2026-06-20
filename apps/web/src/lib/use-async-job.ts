"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { JobType } from "@lumio/shared";
import { useActivity } from "@/lib/use-activity";

export type AsyncJobPhase = "idle" | "pending" | "error";

/**
 * The job is done when we're pending, it's no longer in the active set, and we
 * actually observed it active at some point (so a not-yet-polled enqueue isn't
 * mistaken for completion).
 */
export function jobCompleted(
  phase: AsyncJobPhase,
  isActive: boolean,
  sawActive: boolean,
): boolean {
  return phase === "pending" && !isActive && sawActive;
}

/** How long to wait for a poll to observe the job before assuming an instant job finished. */
const FALLBACK_MS = 2500;

/**
 * Enqueue-and-watch helper for the danger-zone style buttons. POSTs to `endpoint`,
 * then tracks the job of `jobType` via useActivity and calls `onComplete` once it
 * leaves the active set (or after a short fallback for jobs that finish between
 * polls, e.g. emptying an already-tiny trash). `finish` is idempotent.
 */
export function useAsyncJob(jobType: JobType, endpoint: string, onComplete: () => void) {
  const snapshot = useActivity();
  const isActive = snapshot.jobs.some((j) => j.type === jobType);
  const [phase, setPhase] = useState<AsyncJobPhase>("idle");
  const sawActive = useRef(false);
  const pendingRef = useRef(false);
  const fallbackTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Keep the latest onComplete without re-running the effect on every poll.
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const finish = useCallback(() => {
    if (!pendingRef.current) return; // idempotent: effect + fallback both call this
    pendingRef.current = false;
    sawActive.current = false;
    setPhase("idle");
    onCompleteRef.current();
  }, []);

  useEffect(() => {
    if (phase !== "pending") return;
    if (isActive) {
      sawActive.current = true;
      return;
    }
    if (sawActive.current) finish();
  }, [isActive, phase, finish]);

  // Cancel an in-flight fallback timer if the component unmounts mid-job.
  useEffect(() => {
    return () => {
      if (fallbackTimer.current) clearTimeout(fallbackTimer.current);
    };
  }, []);

  const run = useCallback(async () => {
    if (fallbackTimer.current) clearTimeout(fallbackTimer.current);
    pendingRef.current = true;
    sawActive.current = false;
    setPhase("pending");
    try {
      const res = await fetch(endpoint, { method: "POST" });
      if (!res.ok) throw new Error(`${endpoint} failed: ${res.status}`);
      // Jobs that finish before any poll observes them active won't trip the
      // effect's saw-active path; complete on a short fallback in that case.
      fallbackTimer.current = setTimeout(() => {
        if (!sawActive.current) finish();
      }, FALLBACK_MS);
    } catch {
      pendingRef.current = false;
      setPhase("error");
    }
  }, [endpoint, finish]);

  return { phase, isActive, run };
}
