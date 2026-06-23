import type { PrismaClient } from "@lumio/db";
import { LogLevel, type WorkerLogEntry } from "@lumio/shared";

/** The slice of Prisma the log helpers need (so tests can pass a mock). */
export type LogDb = Pick<PrismaClient, "workerLog">;

/** Optional structured tags attached to a log entry. */
export interface LogMeta {
  scope?: string;
  catalogId?: string | null;
  jobId?: string | null;
}

export interface WorkerLogger {
  error(message: string, meta?: LogMeta): void;
  warn(message: string, meta?: LogMeta): void;
  info(message: string, meta?: LogMeta): void;
  debug(message: string, meta?: LogMeta): void;
  /** Persist buffered entries now. */
  flush(): Promise<void>;
  /** Final flush + stop the background timers. */
  close(): Promise<void>;
}

/** Ring-buffer bounds: keep at most this many rows and at most this age. */
export const LOG_MAX_ROWS = 10_000;
export const LOG_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const FLUSH_THRESHOLD = 50;
const FLUSH_INTERVAL_MS = 1000;
const TRIM_INTERVAL_MS = 30_000;

type ConsoleLike = Pick<Console, "log" | "warn" | "error" | "debug">;

interface BufferRow {
  level: LogLevel;
  scope: string | null;
  message: string;
  catalogId: string | null;
  jobId: string | null;
  createdAt: Date;
}

export interface WorkerLoggerOptions {
  now?: () => number;
  flushThreshold?: number;
  maxRows?: number;
  maxAgeMs?: number;
  console?: ConsoleLike;
}

/**
 * A batched "tee" logger: every call prints to the console immediately
 * (preserving terminal UX) and buffers a row that is flushed to Postgres in
 * batches. A slow background timer trims the table to a ring buffer. A failed
 * DB write is swallowed — logging must never crash the worker.
 */
export function createWorkerLogger(db: LogDb, options: WorkerLoggerOptions = {}): WorkerLogger {
  const now = options.now ?? (() => Date.now());
  const threshold = options.flushThreshold ?? FLUSH_THRESHOLD;
  const maxRows = options.maxRows ?? LOG_MAX_ROWS;
  const maxAgeMs = options.maxAgeMs ?? LOG_MAX_AGE_MS;
  const out: ConsoleLike = options.console ?? console;

  let buffer: BufferRow[] = [];

  const tee = (level: LogLevel, message: string): void => {
    if (level === LogLevel.Error) out.error(message);
    else if (level === LogLevel.Warn) out.warn(message);
    else if (level === LogLevel.Debug) out.debug(message);
    else out.log(message);
  };

  const flush = async (): Promise<void> => {
    if (buffer.length === 0) return;
    const rows = buffer;
    buffer = [];
    try {
      await db.workerLog.createMany({ data: rows });
    } catch {
      // best-effort telemetry: drop the batch rather than crash.
    }
  };

  const enqueue = (level: LogLevel, message: string, meta?: LogMeta): void => {
    tee(level, message);
    buffer.push({
      level,
      scope: meta?.scope ?? null,
      message,
      catalogId: meta?.catalogId ?? null,
      jobId: meta?.jobId ?? null,
      createdAt: new Date(now()),
    });
    if (buffer.length >= threshold) void flush();
  };

  const flushTimer = setInterval(() => void flush(), FLUSH_INTERVAL_MS);
  const trimTimer = setInterval(
    () => void trimWorkerLogs(db, { now, maxRows, maxAgeMs }),
    TRIM_INTERVAL_MS,
  );
  // Don't keep the event loop alive just for logging timers.
  flushTimer.unref();
  trimTimer.unref();

  return {
    error: (m, meta) => enqueue(LogLevel.Error, m, meta),
    warn: (m, meta) => enqueue(LogLevel.Warn, m, meta),
    info: (m, meta) => enqueue(LogLevel.Info, m, meta),
    debug: (m, meta) => enqueue(LogLevel.Debug, m, meta),
    flush,
    close: async () => {
      clearInterval(flushTimer);
      clearInterval(trimTimer);
      await flush();
    },
  };
}

export interface TrimOptions {
  now?: () => number;
  maxRows?: number;
  maxAgeMs?: number;
}

/** Enforce the ring buffer: drop rows older than maxAgeMs, then any beyond maxRows. */
export async function trimWorkerLogs(db: LogDb, options: TrimOptions = {}): Promise<void> {
  const now = options.now ?? (() => Date.now());
  const maxRows = options.maxRows ?? LOG_MAX_ROWS;
  const maxAgeMs = options.maxAgeMs ?? LOG_MAX_AGE_MS;
  try {
    await db.workerLog.deleteMany({ where: { createdAt: { lt: new Date(now() - maxAgeMs) } } });
    const boundary = await db.workerLog.findFirst({
      orderBy: { createdAt: "desc" },
      skip: maxRows,
      select: { createdAt: true },
    });
    if (boundary) {
      await db.workerLog.deleteMany({ where: { createdAt: { lt: boundary.createdAt } } });
    }
  } catch {
    // best-effort
  }
}

export interface GetLogsQuery {
  levels?: LogLevel[];
  before?: Date;
  after?: Date;
  limit: number;
}

function toLogEntry(row: {
  id: string;
  level: string;
  scope: string | null;
  message: string;
  catalogId: string | null;
  jobId: string | null;
  createdAt: Date;
}): WorkerLogEntry {
  return {
    id: row.id,
    level: row.level as LogLevel,
    scope: row.scope,
    message: row.message,
    catalogId: row.catalogId,
    jobId: row.jobId,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Read worker logs newest-first, filtered by level + optional time window. */
export async function getWorkerLogs(db: LogDb, query: GetLogsQuery): Promise<WorkerLogEntry[]> {
  const where: { level?: { in: LogLevel[] }; createdAt?: { lt?: Date; gte?: Date } } = {};
  if (query.levels && query.levels.length > 0) where.level = { in: query.levels };
  const range: { lt?: Date; gte?: Date } = {};
  if (query.before) range.lt = query.before;
  if (query.after) range.gte = query.after;
  if (range.lt || range.gte) where.createdAt = range;

  const rows = await db.workerLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: query.limit,
  });
  return rows.map(toLogEntry);
}
