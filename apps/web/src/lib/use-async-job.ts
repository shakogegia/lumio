"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { JobType } from "@lumio/shared";
import { useActivity } from "@/lib/use-activity";

export type AsyncJobPhase = "idle" | "pending" | "error";

/** Toast copy for the job's lifecycle: loading on start → success/error on settle. */
export interface AsyncJobToasts {
  pending: string;
  success: string;
  error?: string;
}

export interface AsyncJobOptions {
  /** Called once the job leaves the active set (or the fast-job fallback fires). */
  onComplete?: () => void;
  /** When set, shows a loading toast on start that resolves to success/error. */
  toasts?: AsyncJobToasts;
}

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
export function useAsyncJob(
  jobType: JobType,
  endpoint: string,
  options: AsyncJobOptions = {},
) {
  const snapshot = useActivity();
  const isActive = snapshot.jobs.some((j) => j.type === jobType);
  const [phase, setPhase] = useState<AsyncJobPhase>("idle");
  const sawActive = useRef(false);
  const pendingRef = useRef(false);
  const fallbackTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const toastId = useRef<string | number | undefined>(undefined);
  // Keep the latest options without re-running the effect on every poll. Synced
  // in an effect (not during render) per the refs-in-render rule.
  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const finish = useCallback(() => {
    if (!pendingRef.current) return; // idempotent: effect + fallback both call this
    pendingRef.current = false;
    sawActive.current = false;
    setPhase("idle");
    const { toasts, onComplete } = optionsRef.current;
    if (toasts) {
      toast.success(toasts.success, toastId.current != null ? { id: toastId.current } : undefined);
    }
    onComplete?.();
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
    const { toasts } = optionsRef.current;
    if (toasts) toastId.current = toast.loading(toasts.pending);
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
      if (toasts) {
        toast.error(
          toasts.error ?? "Something went wrong.",
          toastId.current != null ? { id: toastId.current } : undefined,
        );
      }
    }
  }, [endpoint, finish]);

  return { phase, isActive, run };
}
