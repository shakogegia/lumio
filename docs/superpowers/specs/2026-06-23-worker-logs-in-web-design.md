# Worker Logs in the Web App — Design

**Date:** 2026-06-23
**Status:** Approved

## Goal

Give the operator a **Logs page in the settings shell** to see what the ingestion
worker is doing — errors, warnings, job lifecycle, and per-file activity — without
needing terminal access to the worker process. Captured logs are filterable by
level and time and rendered live in a scrollable view.

## Background / current state

- The **worker** (`apps/worker`) only writes to `console.log/warn/error` →
  stdout/stderr. Nothing is persisted.
- There is already a DB-backed status layer in **`@lumio/jobs`**: a `WorkerStatus`
  singleton (heartbeat + short `activity` string) and a `Job` table (progress,
  message, error). The web app reads these via `GET /api/c/[catalog]/activity`,
  surfaced today only as a colored "pupil" on the logo (`WorkerActivity`).
- Wire types (e.g. `ActivitySnapshot`) live in `packages/shared/src/jobs.ts`.
- Worker↔web communicate **only through Postgres** (the project's deliberate single
  chokepoint). The worker may run as a separate process or host.

## Approach

**Storage — a Postgres table via Prisma.** Matches the existing `WorkerStatus` /
`Job` pattern and works across the process/host boundary. A disk log file would
break when web and worker aren't co-located and couldn't be tailed cleanly by the
web app; Redis/external log systems add infra for no benefit. Rejected both.

**Capture — a batched "tee" logger.** The worker keeps printing to its terminal,
and the same call buffers the entry and flushes to Postgres in batches
(`createMany`). A naive per-line synchronous DB write would add a round-trip per
file and wreck ingest throughput, so batching is required.

## Design

### 1. Data model — `WorkerLog`

New Prisma model in `packages/db/prisma/schema.prisma`:

```prisma
model WorkerLog {
  id        String   @id @default(cuid())
  level     String   // "error" | "warn" | "info" | "debug"
  scope     String?  // "scan" | "watch" | "consumer" | "heartbeat" | "startup"
  message   String
  catalogId String?
  jobId     String?
  createdAt DateTime @default(now())

  @@index([createdAt])
  @@index([level, createdAt])
}
```

The table is **additive** (new table only), so the migration is safe on the shared
dev DB — no reset, no backfill.

### 2. Wire types — `packages/shared/src/logs.ts`

Framework-agnostic (no Prisma/Next), exported from `packages/shared/src/index.ts`:

- `enum LogLevel { Error = "error", Warn = "warn", Info = "info", Debug = "debug" }`
  (follows the repo's `enums.ts` TS-enum preference).
- `WorkerLogEntry` — `{ id, level: LogLevel, scope: string | null, message,
  catalogId: string | null, jobId: string | null, createdAt: string }` (ISO string
  on the wire).
- `LogsResponse` — `{ entries: WorkerLogEntry[]; nextBefore: string | null }`.
- A Zod schema / parser for the query params (`level`, `before`, `limit`) consistent
  with how `packages/shared` validates other API inputs.

### 3. Worker logger — `packages/jobs/src/log.ts`

Lives beside `heartbeat.ts`; exported from `packages/jobs/src/index.ts`.

```ts
createWorkerLogger(db, opts?) → {
  error(message, meta?): void
  warn(message, meta?): void
  info(message, meta?): void
  debug(message, meta?): void
  flush(): Promise<void>
  close(): Promise<void>   // final flush + stop timers
}
// meta = { scope?: string; catalogId?: string | null; jobId?: string | null }
```

Behavior:
- **Tee**: each call writes to the matching `console.*` immediately (preserving
  terminal UX) and pushes a row onto an in-memory buffer.
- **Batched flush**: flush via `createMany` when the buffer reaches a threshold
  (~50 entries) or on a ~1s timer, whichever comes first.
- **Ring-buffer trim**: on a slower cadence (~30s, or every Nth flush), one DELETE
  enforces ≤ `MAX_ROWS` (10,000) **and** ≤ `MAX_AGE` (7 days). Constants are
  exported so they're easy to tune.
- **Shutdown safety**: `close()` does a final flush; the worker wires it to
  SIGINT/SIGTERM/beforeExit so no buffered entries are lost.

Read helper for the API:
```ts
getWorkerLogs(db, { levels?: LogLevel[]; before?: Date; limit: number })
  → Promise<WorkerLogEntry[]>   // newest-first
```

### 4. Worker integration ("make logs well")

Instantiate **one** logger at worker startup and thread it through the long-running
paths, replacing scattered `console.*` with leveled, scoped calls. Each entry gets a
`scope` and, where relevant, `catalogId` / `jobId`.

| Scope       | Entries                                                                              |
|-------------|-------------------------------------------------------------------------------------|
| `startup`   | worker started; catalogs being watched; concurrency                                 |
| `scan`      | `processed <rel> <ms>` (info, per file); ingest summary `N processed, M skipped` (info); `skip <rel>: …` (warn); `remove failed <path>: …` (warn) |
| `watch`     | `Watching …` (info); `healed`/`restamped` (info); `skip …` (warn); watcher error (error); catalog added/removed (info) |
| `consumer`  | job `<type>` started (info); finished with counts (info); failed `<error>` (error)  |
| `heartbeat` | heartbeat write failed (warn)                                                        |

One-off CLI scripts (`seed`, `bench`, `backfill-thumbhash`) **stay on plain
console** — they are manual dev tools, not the daemon, so they don't pollute the
persisted log.

### 5. Web API — `GET /api/logs`

New **global** route `apps/web/src/app/api/logs/route.ts` (not catalog-scoped),
guarded by `withAuth` like `/api/features`.

- Query: `?level=error,warn&before=<iso>&limit=200` (level optional/multi; `before`
  optional cursor; `limit` clamped, default ~200).
- Parses query with the shared schema, calls `getWorkerLogs`, returns `LogsResponse`
  newest-first with `nextBefore` = the oldest returned `createdAt` (or null when the
  page wasn't full).
- DB unreachable → 503 with an empty page, matching the activity route's resilience.

### 6. Settings page — `/settings/logs`

- **Nav**: add `{ href: "/settings/logs", label: "Logs", icon: ScrollText }` to
  `ITEMS` in `apps/web/src/components/settings-sidebar.tsx`.
- **Route**: `apps/web/src/app/(app)/settings/logs/page.tsx` (server shell) renders a
  client `logs-view.tsx`.
- **`logs-view.tsx`**:
  - **Level filter** — toggle chips Error / Warn / Info / Debug, all enabled by
    default; toggling refetches.
  - **Since filter** — quick-select Last hour / 24h / 7d (no full date-range picker).
    Every row also shows its own timestamp.
  - **List** — shadcn **ScrollArea** holding monospace, level-color-coded rows
    (error = red, warn = amber, info = muted-foreground, debug = dim). Columns:
    timestamp · level · scope · message (with optional catalog/job hint).
  - **Paging** — load older entries (cursor by `before`) when scrolled near the
    bottom.
  - **Live tail** — while the tab is visible, poll for entries newer than the newest
    loaded one and prepend them, reusing the adaptive-cadence approach from
    `use-activity` (fast while busy, slow when idle, paused when hidden). Extract the
    fetch/poll into a `use-logs` hook.
  - **Empty / offline** states — friendly empty message; if the worker is offline the
    last logs still render (it's just historical data).
- ⚠️ shadcn `scroll-area` is **not installed** — add it via the shadcn registry
  before building the view.

### 7. Retention

The logger's periodic trim keeps the table at ≤ 10,000 rows **and** ≤ 7 days
automatically. No external cron or manual maintenance.

### 8. Testing

- `packages/jobs/src/log.test.ts`:
  - buffering defers writes until threshold/flush;
  - `close()` performs a final flush;
  - trim keeps the newest ≤ `MAX_ROWS` and drops rows older than `MAX_AGE`;
  - `getWorkerLogs` filters by level, respects `before`, and honors `limit`,
    newest-first.
- Reuse existing scan/watch tests for worker behavior (they assert behavior, not
  console output, so swapping in the logger shouldn't break them — verify).
- Shared `logs.ts` query-parser test if other shared parsers are tested (they are).

### 9. Migration

Generate the `WorkerLog` migration via the project's normal flow
(`pnpm db:migrate` / `db:generate`). Because it only **adds** a table, it is safe on
the shared dev DB; do not reset or backfill.

## Out of scope (YAGNI)

- Full date-range picker (the Since quick-select covers the need).
- Per-catalog log pages (the worker is global; entries carry an optional `catalogId`).
- Log export/download, full-text search backend, or log streaming via SSE/LISTEN-
  NOTIFY (the poll seam can be upgraded later, exactly as `use-activity` notes).
- Routing one-off CLI script output into the persisted store.
