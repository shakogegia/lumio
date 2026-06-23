import type { PrismaClient } from "@lumio/db";
import { createWorkerLogger, type LogMeta, type WorkerLogger } from "@lumio/jobs";

// Process-wide logger. Until initWorkerLog() runs (tests, one-off CLI scripts
// that don't activate persistence), calls fall back to plain console so nothing
// double-prints and no DB writes happen.
let impl: WorkerLogger | null = null;

export const log = {
  error: (message: string, meta?: LogMeta) => (impl ? impl.error(message, meta) : console.error(message)),
  warn: (message: string, meta?: LogMeta) => (impl ? impl.warn(message, meta) : console.warn(message)),
  info: (message: string, meta?: LogMeta) => (impl ? impl.info(message, meta) : console.log(message)),
  debug: (message: string, meta?: LogMeta) => (impl ? impl.debug(message, meta) : console.debug(message)),
};

/**
 * Activate DB-backed logging for the current process. Returns a close fn that
 * flushes buffered entries — wire it to shutdown so nothing is lost.
 */
export function initWorkerLog(db: Pick<PrismaClient, "workerLog">): () => Promise<void> {
  impl = createWorkerLogger(db);
  return async () => {
    const current = impl;
    impl = null;
    if (current) await current.close();
  };
}
