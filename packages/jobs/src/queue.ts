import type { Job, PrismaClient } from "@lumio/db";
import { ACTIVE_JOB_STATUSES, JobStatus, type JobType } from "@lumio/shared";

/** The slice of Prisma the queue helpers need (so tests can pass a mock). */
export type JobDb = Pick<PrismaClient, "job" | "$queryRaw">;

/** The oldest in-flight (queued or running) job of a type, if any. */
export function findActiveJob(db: JobDb, type: JobType): Promise<Job | null> {
  return db.job.findFirst({
    where: { type, status: { in: [...ACTIVE_JOB_STATUSES] } },
    orderBy: { createdAt: "asc" },
  });
}

/** Enqueue a job, de-duping against an already-active job of the same type. */
export async function enqueueJob(db: JobDb, type: JobType): Promise<Job> {
  const active = await findActiveJob(db, type);
  if (active) return active;
  return db.job.create({ data: { type } });
}

/** All in-flight jobs, oldest first — for the activity endpoint. */
export function getActiveJobs(db: JobDb): Promise<Job[]> {
  return db.job.findMany({
    where: { status: { in: [...ACTIVE_JOB_STATUSES] } },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * On worker startup, any job still marked `running` is orphaned (a single
 * worker that just booted can't be running anything yet) — requeue it.
 */
export async function recoverOrphanedJobs(db: JobDb): Promise<number> {
  const { count } = await db.job.updateMany({
    where: { status: JobStatus.running },
    data: { status: JobStatus.queued, startedAt: null },
  });
  return count;
}

export async function markJobSucceeded(db: JobDb, id: string): Promise<void> {
  await db.job.update({
    where: { id },
    data: { status: JobStatus.succeeded, finishedAt: new Date() },
  });
}

export async function markJobFailed(db: JobDb, id: string, error: string): Promise<void> {
  await db.job.update({
    where: { id },
    data: { status: JobStatus.failed, error, finishedAt: new Date() },
  });
}

/**
 * Atomically claim the oldest queued job, flipping it to `running`. Uses
 * `FOR UPDATE SKIP LOCKED` so the claim stays correct even if a second worker
 * is ever added (each gets a distinct row, never the same one). Returns the
 * claimed row, or null if the queue is empty.
 */
export async function claimNextJob(db: JobDb): Promise<Job | null> {
  const rows = await db.$queryRaw<Job[]>`
    UPDATE "Job" SET status = 'running', "startedAt" = now()
    WHERE id = (
      SELECT id FROM "Job"
      WHERE status = 'queued'
      ORDER BY "createdAt" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `;
  return rows[0] ?? null;
}
