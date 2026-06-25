import { z } from "zod";

/** Discrete, user-initiated background operations. Mirrors the Job.type column 1:1. */
export enum JobType {
  rescan = "rescan",
  purge_all = "purge_all",
  empty_trash = "empty_trash",
  process_trash = "process_trash",
}

/** Job lifecycle states. Mirrors the Job.status column 1:1. */
export enum JobStatus {
  queued = "queued",
  running = "running",
  succeeded = "succeeded",
  failed = "failed",
  canceled = "canceled",
}

/** Statuses that count as "in flight" (occupies the queue, shows in the UI). */
export const ACTIVE_JOB_STATUSES = [JobStatus.queued, JobStatus.running] as const;

/** Zod schema for a job type (strict — used in API validation). */
export const jobTypeSchema = z.nativeEnum(JobType);

export function isJobType(value: unknown): value is JobType {
  return Object.values(JobType).includes(value as JobType);
}

/** Serialized job for the web (dates as ISO strings). */
export interface JobDTO {
  id: string;
  type: JobType;
  status: JobStatus;
  total: number | null;
  processed: number;
  message: string | null;
  error: string | null;
}

/** Response shape for GET /api/activity. */
export interface ActivitySnapshot {
  worker: { online: boolean; activity: string };
  jobs: JobDTO[];
}
