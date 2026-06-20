import type { PrismaClient, WorkerStatus } from "@lumio/db";

export type HeartbeatDb = Pick<PrismaClient, "workerStatus">;

const SINGLETON_ID = "singleton";

/** Worker is considered offline if its heartbeat is older than this. */
export const WORKER_STALE_MS = 6000;

/** Upsert the single WorkerStatus row. The heartbeat loop is its sole writer. */
export async function writeHeartbeat(
  db: HeartbeatDb,
  activity: string,
  jobId: string | null,
  now: Date = new Date(),
): Promise<void> {
  await db.workerStatus.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID, lastSeenAt: now, activity, jobId },
    update: { lastSeenAt: now, activity, jobId },
  });
}

export function readWorkerStatus(db: HeartbeatDb): Promise<WorkerStatus | null> {
  return db.workerStatus.findUnique({ where: { id: SINGLETON_ID } });
}
