import { prisma } from "@lumio/db";
import {
  formatActivity,
  recoverOrphanedJobs,
  runJobConsumer,
  sleep,
  writeHeartbeat,
} from "@lumio/jobs";
import { errorMessage, JobStatus } from "@lumio/shared";
import { activity } from "./activity.js";
import { buildHandlers } from "./handlers.js";
import { log, initWorkerLog } from "./log.js";
import { startWatcher } from "./watch.js";

const HEARTBEAT_MS = 2000;

/**
 * Boot the worker: requeue orphaned jobs, then run the heartbeat loop, the job
 * consumer, and the file watcher concurrently until a shutdown signal arrives.
 */
export async function startWorker(): Promise<void> {
  const controller = new AbortController();
  const { signal } = controller;

  const closeLog = initWorkerLog(prisma);
  log.info("worker started", { scope: "startup" });

  const shutdown = async (): Promise<void> => {
    // Abort wakes all loops within one sleep interval. We deliberately do NOT
    // await them before disconnecting: an in-flight job left "running" is
    // requeued by recoverOrphanedJobs on next boot (single-host tradeoff).
    controller.abort();
    await closeLog();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  await recoverOrphanedJobs(prisma);

  const heartbeat = (async () => {
    while (!signal.aborted) {
      await writeHeartbeat(
        prisma,
        formatActivity(activity),
        activity.currentJob?.id ?? null,
      ).catch((err) => log.warn(`heartbeat failed: ${errorMessage(err)}`, { scope: "heartbeat" }));
      await sleep(HEARTBEAT_MS, signal);
    }
  })();

  const consumer = runJobConsumer(prisma, buildHandlers(), {
    signal,
    onClaim: (job) => {
      activity.currentJob = { id: job.id, type: job.type };
      log.info(`job ${job.type} started`, { scope: "consumer", jobId: job.id, catalogId: job.catalogId });
    },
    onSettle: (job) => {
      activity.currentJob = null;
      // Re-read the settled row so we log the real outcome (the claimed job was
      // still "running"). Best-effort — never throw out of a settle callback.
      void prisma.job
        .findUnique({ where: { id: job.id } })
        .then((settled) => {
          if (!settled) return;
          if (settled.status === JobStatus.failed) {
            log.error(`job ${job.type} failed: ${settled.error ?? "unknown error"}`, { scope: "consumer", jobId: job.id, catalogId: job.catalogId });
          } else {
            log.info(`job ${job.type} ${settled.status}`, { scope: "consumer", jobId: job.id, catalogId: job.catalogId });
          }
        })
        .catch(() => {});
    },
  });

  await startWatcher(signal);

  await Promise.all([heartbeat, consumer]);
}
