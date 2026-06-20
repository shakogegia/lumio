import { prisma } from "@lumio/db";
import {
  formatActivity,
  recoverOrphanedJobs,
  runJobConsumer,
  sleep,
  writeHeartbeat,
} from "@lumio/jobs";
import { activity } from "./activity.js";
import { buildHandlers } from "./handlers.js";
import { startWatcher } from "./watch.js";

const HEARTBEAT_MS = 2000;

/**
 * Boot the worker: requeue orphaned jobs, then run the heartbeat loop, the job
 * consumer, and the file watcher concurrently until a shutdown signal arrives.
 */
export async function startWorker(): Promise<void> {
  const controller = new AbortController();
  const { signal } = controller;

  const shutdown = async (): Promise<void> => {
    // Abort wakes all loops within one sleep interval. We deliberately do NOT
    // await them before disconnecting: an in-flight job left "running" is
    // requeued by recoverOrphanedJobs on next boot (single-host tradeoff).
    controller.abort();
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
      ).catch((err) => console.warn(`heartbeat failed: ${(err as Error).message}`));
      await sleep(HEARTBEAT_MS, signal);
    }
  })();

  const consumer = runJobConsumer(prisma, buildHandlers(), {
    signal,
    onClaim: (job) => {
      activity.currentJob = { id: job.id, type: job.type };
    },
    onSettle: () => {
      activity.currentJob = null;
    },
  });

  await startWatcher(signal);

  await Promise.all([heartbeat, consumer]);
}
