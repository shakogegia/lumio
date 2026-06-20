import type { Job, WorkerStatus } from "@lumio/db";
import type { ActivitySnapshot, JobDTO, JobType } from "@lumio/shared";

/** Worker is online if its heartbeat landed within the stale window. */
export function isWorkerOnline(
  lastSeenAt: Date | null | undefined,
  now: Date,
  staleMs: number,
): boolean {
  if (!lastSeenAt) return false;
  return now.getTime() - lastSeenAt.getTime() <= staleMs;
}

/** In-process activity snapshot the worker keeps; rendered to a status string. */
export interface ActivityState {
  importing: number;
  currentJob: { id: string; type: string } | null;
}

/** Human status string: current job wins, then watcher imports, then idle. */
export function formatActivity(state: ActivityState): string {
  if (state.currentJob) return `running: ${state.currentJob.type}`;
  if (state.importing > 0) return `importing ${state.importing}`;
  return "watching";
}

/** Throttle gate: write if never written or the min interval has elapsed. */
export function shouldWrite(lastAt: number | null, now: number, minIntervalMs: number): boolean {
  return lastAt === null || now - lastAt >= minIntervalMs;
}

/** Serialize a Job row to the wire DTO (drops dates the UI doesn't need). */
export function toJobDTO(job: Job): JobDTO {
  return {
    id: job.id,
    type: job.type as JobType,
    status: job.status as JobDTO["status"],
    total: job.total,
    processed: job.processed,
    message: job.message,
    error: job.error,
  };
}

/** Assemble the GET /api/activity payload from the worker row + active jobs. */
export function buildActivitySnapshot(
  worker: WorkerStatus | null,
  jobs: Job[],
  now: Date,
  staleMs: number,
): ActivitySnapshot {
  return {
    worker: {
      online: isWorkerOnline(worker?.lastSeenAt, now, staleMs),
      activity: worker?.activity ?? "offline",
    },
    jobs: jobs.map(toJobDTO),
  };
}
