import type { PrismaClient } from "@lumio/db";
import { shouldWrite } from "./predicates.js";

export type ProgressDb = Pick<PrismaClient, "job">;

/** Called by handlers to publish progress; signature is (processed, total, message). */
export type ProgressReporter = (
  processed: number,
  total: number | null,
  message: string | null,
) => Promise<void>;

export interface ProgressOptions {
  minIntervalMs?: number;
  now?: () => number;
}

/**
 * A throttled progress writer for one job: writes the first update immediately,
 * then at most once per `minIntervalMs` so a large scan doesn't hammer Postgres.
 */
export function createProgressReporter(
  db: ProgressDb,
  jobId: string,
  options: ProgressOptions = {},
): ProgressReporter {
  const minIntervalMs = options.minIntervalMs ?? 250;
  const now = options.now ?? (() => Date.now());
  let lastAt: number | null = null;

  return async (processed, total, message) => {
    const t = now();
    if (!shouldWrite(lastAt, t, minIntervalMs)) return;
    lastAt = t;
    await db.job.update({ where: { id: jobId }, data: { processed, total, message } });
  };
}
