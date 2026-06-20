import { z } from "zod";

/** Discrete, user-initiated background operations. Single source of truth. */
export const JOB_TYPES = ["rescan", "purge_all", "empty_trash"] as const;
export type JobType = (typeof JOB_TYPES)[number];

/** Job lifecycle states. */
export const JOB_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "canceled",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** Statuses that count as "in flight" (occupies the queue, shows in the UI). */
export const ACTIVE_JOB_STATUSES = ["queued", "running"] as const;

export const jobTypeSchema = z.enum(JOB_TYPES);

export function isJobType(value: unknown): value is JobType {
  return (JOB_TYPES as readonly unknown[]).includes(value);
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
