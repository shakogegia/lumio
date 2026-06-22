import type { Job } from "@lumio/db";
import type { JobType } from "@lumio/shared";
import { createProgressReporter, type ProgressReporter } from "./progress.js";
import { claimNextJob, type JobDb, markJobFailed, markJobSucceeded } from "./queue.js";

/** One handler per job type; receives a throttled progress reporter and the claimed job. */
export type JobHandler = (report: ProgressReporter, job: Job) => Promise<void>;
export type JobHandlers = Partial<Record<JobType, JobHandler>>;

export interface ConsumerOptions {
  onClaim?: (job: Job) => void;
  onSettle?: (job: Job) => void;
  signal?: AbortSignal;
  idleMs?: number;
}

/** Sleep that resolves early if the signal aborts. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

/**
 * Claim and run one job. Returns "empty" if nothing was queued, "ran" otherwise.
 * Always marks the job (succeeded/failed) and calls onSettle, even on throw.
 */
export async function processNextJob(
  db: JobDb,
  handlers: JobHandlers,
  options: ConsumerOptions,
): Promise<"ran" | "empty"> {
  const job = await claimNextJob(db);
  if (!job) return "empty";

  options.onClaim?.(job);
  try {
    const handler = handlers[job.type as JobType];
    if (!handler) throw new Error(`No handler for job type: ${job.type}`);
    const report = createProgressReporter(db, job.id);
    await handler(report, job);
    await markJobSucceeded(db, job.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await markJobFailed(db, job.id, message);
  } finally {
    options.onSettle?.(job);
  }
  return "ran";
}

/**
 * The worker's job loop: drain the queue, sleeping `idleMs` whenever it's empty,
 * until the abort signal fires. A claim/run error never kills the loop.
 */
export async function runJobConsumer(
  db: JobDb,
  handlers: JobHandlers,
  options: ConsumerOptions,
): Promise<void> {
  const { signal, idleMs = 1000 } = options;
  while (!signal?.aborted) {
    const result = await processNextJob(db, handlers, options).catch(() => "empty" as const);
    if (result === "empty") await sleep(idleMs, signal);
  }
}
