import { z } from "zod";

/** Worker log severity. Mirrors the WorkerLog.level column. */
export enum LogLevel {
  Error = "error",
  Warn = "warn",
  Info = "info",
  Debug = "debug",
}

/** All levels, most-severe-first, for UI iteration. */
export const LOG_LEVELS = [LogLevel.Error, LogLevel.Warn, LogLevel.Info, LogLevel.Debug] as const;

/** Serialized worker log entry for the web (createdAt as ISO string). */
export interface WorkerLogEntry {
  id: string;
  level: LogLevel;
  scope: string | null;
  message: string;
  catalogId: string | null;
  jobId: string | null;
  createdAt: string;
}

/** Response shape for GET /api/logs. `nextBefore` is the cursor for the next older page. */
export interface LogsResponse {
  entries: WorkerLogEntry[];
  nextBefore: string | null;
}

/** Default page size and hard ceiling for GET /api/logs. */
export const LOGS_PAGE_SIZE = 200;
export const LOGS_MAX_LIMIT = 500;

function isLogLevel(value: string): value is LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value);
}

/** Parse + validate the GET /api/logs query string. */
export const logsQuerySchema = z.object({
  // Comma-separated list; unknown tokens are dropped rather than rejected.
  level: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(",").filter(isLogLevel) : [])),
  before: z.string().datetime().optional(),
  since: z.string().datetime().optional(),
  limit: z.coerce.number().int().positive().max(LOGS_MAX_LIMIT).default(LOGS_PAGE_SIZE),
});
export type LogsQuery = z.infer<typeof logsQuerySchema>;
