# Worker Activity & Async Jobs: Postgres-backed Status, No Redis

**Date:** 2026-06-20
**Status:** Proposed — awaiting review
**Target deploy:** Single host — one web container, one worker container, one Postgres (current docker-compose topology). Must stay portable, no new infrastructure to operate.

## Problem

The web app has **no visibility into the worker**, and bulk operations **block the request** until they finish.

Today web and worker share exactly one thing: the Postgres database. Concretely:

1. **No worker visibility.** The worker (chokidar watcher, `apps/worker/src/watch-main.ts`) logs only to stdout. The web app cannot tell whether the worker is alive, idle, or busy importing newly-dropped files.

2. **Fire-and-forget rescan with no progress.** `POST /api/rescan` (`apps/web/src/app/api/rescan/route.ts`) `spawn`s a detached child process (`stdio: "ignore"`), returns `202`, and never learns whether it succeeded, failed, or how far it got. The user clicks "rescan" and it vanishes into the void.

3. **Synchronous bulk deletes.** `POST /api/photos/purge` (`purgeAllPhotos` in `apps/web/src/lib/photos-service.ts`) and `POST /api/trash/empty` (`apps/web/src/lib/trash-service.ts`) delete every file + row **inside the HTTP request**. On a large library this holds the request open for a long time, with no progress and a real risk of client/proxy timeout.

There is no job queue, no progress tracking, no pub/sub, and no Redis anywhere in the codebase.

### The decision this spec settles: no Redis

The obvious reach is "add Redis + BullMQ for a job queue and pub/sub." For a **single-host** deployment that is premature infrastructure. Postgres — already shared by both processes — can be the queue (a `jobs` table claimed with `FOR UPDATE SKIP LOCKED`), the progress store (columns on that row), and, later if wanted, the live-push transport (`LISTEN/NOTIFY`). Redis would add a container to run, back up, and keep in sync for zero capability we can't get from the database we already run.

**Redis is reconsidered only if the deployment goes multi-worker / horizontally-scaled.** The design below keeps that door open (the claim query is already multi-worker-correct) without paying for it now.

## Goals

- Web can show, everywhere, whether the **worker is online** and **what it's doing right now** (idle / watching / importing N / running a job).
- **Rescan, delete-all, and empty-trash run asynchronously** as tracked jobs with live progress; the triggering request returns immediately.
- The web UI updates with **poll-based** refresh (cheap, simple, no infra), behind a single seam that can be swapped to **push** (`LISTEN/NOTIFY` → SSE) later with no UI changes.
- Background work is **consolidated in the worker** — the one process that already owns the filesystem and runs long.
- **No new infrastructure.** Postgres only.

## Non-Goals (v1)

- **No Redis / BullMQ / external broker.** Revisit only on a multi-worker deployment.
- **No job-history page, retries UI, or cancellation UI.** The data model leaves room for all three; we don't build them now.
- **No migration of per-file uploads into the jobs system.** Uploads stay as-is (client-tracked, synchronous-per-file).
- **No parallel job execution.** One job at a time (serial), single worker.
- **No push transport yet.** Polling now; `LISTEN/NOTIFY` is a documented, non-breaking upgrade path, not built here.

## Design

### Architecture shift

```
Before:                          After:
Web --spawn detached child-->    Web --INSERT Job row--> Postgres(jobs)
Worker (watcher) -- stdout       Worker (watcher + heartbeat + job consumer)
       \                                \  claim/run/report
        Postgres (photos only)           Postgres (photos + jobs + worker_status)
Web --poll DB on reload                 Web --poll /api/activity--> live indicator
```

Web becomes a pure **producer + reader**. The worker becomes the single **consumer** of background work, in addition to its existing watch duties.

### 1. Data model (`packages/db/prisma/schema.prisma`)

Two new tables.

`Job` — discrete, user-initiated operations with progress + history:

```prisma
model Job {
  id         String    @id @default(cuid())
  type       String    // "rescan" | "purge_all" | "empty_trash"
  status     String    @default("queued") // queued | running | succeeded | failed | canceled
  total      Int?      // null until the worker knows the count
  processed  Int       @default(0)
  message    String?   // human step, e.g. "Deleting renditions…"
  error      String?
  createdAt  DateTime  @default(now())
  startedAt  DateTime?
  finishedAt DateTime?

  @@index([status, createdAt])
}
```

`WorkerStatus` — a single heartbeat row (`id` always `"singleton"`) for ambient liveness + the watcher's continuous activity (which has no natural start/end and is therefore *not* a Job):

```prisma
model WorkerStatus {
  id         String   @id            // always "singleton"
  lastSeenAt DateTime
  activity   String   @default("idle") // "idle" | "watching" | "importing N" | "running: rescan"
  jobId      String?  // job currently executing, if any
}
```

**Why two mechanisms:** Jobs are things a user *starts and watches* (progress bar, future history). The heartbeat is "is the worker alive + what's the always-on watcher doing right now." Forcing the perpetual watcher into a Job row would mean an unending job; keeping them separate is cleaner. The web combines both into one indicator.

Status string unions/consts live in `packages/shared` (matching its existing enum pattern) so web and worker agree on the literals.

### 2. The `packages/jobs` package (new)

Framework-agnostic, dependency-injected (same DI shape as `packages/ingest`'s `deps.ts`: db client + filesystem paths). Holds:

- **Handlers**, keyed by job `type`, each `(deps, reportProgress) => Promise<void>`:
  - `rescan` → wraps the worker's `runIngest()`, reporting `processed`/`total` as it scans.
  - `purge_all` → the delete-all logic **relocated** from `apps/web/src/lib/photos-service.ts`.
  - `empty_trash` → the trash-purge logic **relocated** from `apps/web/src/lib/trash-service.ts`.
- **`reportProgress({ processed, total, message })`** — writes to the `Job` row, **throttled to ≤1 write / 250ms** so large counts don't hammer Postgres.
- **The consumer loop** + the **claim** query + **crash recovery** (below).

The relocation is the one real cost of this approach. It is also the correct boundary: the worker owns the filesystem, so file-deleting logic belongs in worker-runnable code, not in a web `lib/` module. Web's old service functions collapse into thin "enqueue a job" calls.

### 3. Worker: two new always-on loops (`apps/worker`)

Run concurrently alongside the existing chokidar watcher.

**Heartbeat loop** — every ~2s, upsert `WorkerStatus`:
```
activity = currentJob ? `running: ${currentJob.type}`
         : watcherBusy ? `importing ${n}`
         : "watching"
lastSeenAt = now()
```
The watcher sets an in-process `watcherBusy` flag (+ count) while ingesting newly-added files, so the heartbeat reflects steady-state import activity that isn't a Job.

**Job consumer loop** — serial (one at a time):

1. **Claim** atomically (multi-worker-correct even though we run one):
   ```sql
   UPDATE "Job" SET status='running', "startedAt"=now()
   WHERE id = (
     SELECT id FROM "Job" WHERE status='queued'
     ORDER BY "createdAt" LIMIT 1
     FOR UPDATE SKIP LOCKED
   ) RETURNING *;
   ```
   (Prisma `$queryRaw`.) Nothing queued → sleep ~1s, loop.
2. **Dispatch** by `type` to the handler; set `WorkerStatus.jobId`.
3. **Finish** → `status='succeeded'`, `finishedAt=now()`; on throw → `status='failed'`, `error=<message>`, `finishedAt`. Clear `WorkerStatus.jobId`.

**Crash recovery** — on worker startup, any `Job` stuck in `running` with a stale `startedAt` (older than ~30s with no advancing heartbeat) is reset to `queued`. Prevents jobs wedged "running" forever after a crash. (Auto-retry; could be "mark failed" instead — a one-line choice, deferred to implementation.)

**Cancellation hook (not built in v1)** — handlers check a cancel flag at each `reportProgress` and bail if `status` flipped to `canceled`. Hooks left in; no UI.

### 4. Web: enqueue + read + poll (`apps/web`)

**Enqueue (producer).** Endpoints stop doing work and insert a row:
- `POST /api/rescan` → insert `{ type: "rescan" }` (replaces the detached `spawn`).
- `POST /api/photos/purge` → insert `{ type: "purge_all" }`, return `202 { jobId }`.
- `POST /api/trash/empty` → insert `{ type: "empty_trash" }`.
- Each first checks for an existing active (queued/running) job of the same type and returns it instead of double-queueing.

**Read.** One endpoint: `GET /api/activity` →
```jsonc
{
  "worker": { "online": true, "activity": "importing 12" },
  "jobs": [ { "id": "...", "type": "rescan", "status": "running",
             "processed": 340, "total": 1200, "message": null } ]
}
```
`online` is derived server-side: `lastSeenAt` within ~3× the heartbeat interval (≈6s).

**Polling hook** — `useActivity()` with adaptive cadence:
- Idle (no active jobs): poll ~5s (keeps the online badge fresh).
- Active (≥1 running/queued job): poll ~1.5s (responsive progress).
- Slows/stops on hidden tab (`visibilitychange`).

This hook is the **single seam** for the future push upgrade: swap its internals for an `EventSource` backed by `LISTEN/NOTIFY`; nothing else changes.

### 5. UI surface (minimal; reuses existing components, no `ui/*` edits)

**Activity indicator = the sidebar aperture logo.** The logo is a lucide `Aperture` (`apps/web/src/components/logo.tsx`), already in the sidebar rail (`apps/web/src/components/app-sidebar.tsx`) with a `transition-transform duration-500 ease-out hover:rotate-90` idiom. The activity treatment reuses that idiom:
- **Worker busy** (active job or watcher importing) → the aperture **spins / slow-pulses**.
- **Idle** → still.
- **Online/offline** → a tiny status dot in a corner of the existing 44×44 (`h-11 w-11`) container (absolute-positioned; there's ~8px padding around the 28×28 icon).
- **Activity text** ("Worker online · importing 12", "Rescanning 340/1,200") on hover/tooltip.

**Operation buttons** (delete-all, empty-trash, rescan): on click they enqueue, then show a pending state driven by `useActivity()`; the aperture + tooltip carry the progress; the button re-enables on job completion. No more frozen request. On job `failed`, surface the `error` (toast/inline).

### Error handling

- Job throw → `failed` + `error` message, shown in UI; worker continues to next job.
- Worker crash mid-job → startup recovery re-queues stale `running` jobs.
- Worker offline → `/api/activity` reports `online: false`; enqueued jobs simply wait in `queued` until the worker returns (no work lost).
- Double-click / concurrent enqueue → de-duped by the active-job check.
- Progress writes throttled (≤1/250ms) to protect Postgres on large counts.

### Testing (Vitest, matching existing setup)

- **Handlers** (`packages/jobs`): each handler against a test DB + temp dirs — `rescan` reports increasing `processed`; `purge_all`/`empty_trash` remove files + rows and report progress; assert final `Job` status/counts.
- **Claim**: enqueue N, claim once → single correct row; a second concurrent claim gets a *different* row (validates `FOR UPDATE SKIP LOCKED`).
- **Crash recovery**: stale `running` job → reset to `queued` on startup.
- **Online derivation**: pure `isOnline(lastSeenAt, now)`.
- **Web**: enqueue endpoints insert the right row + de-dupe an active job; `/api/activity` shape.
- **Hook**: `useActivity()` cadence switches idle↔active and slows on hidden tab.

### Rollout order (each step independently shippable)

1. Schema migration (`Job`, `WorkerStatus`) — additive, safe.
2. `packages/jobs`: relocate purge/empty-trash into DI handlers + consumer loop + claim/recovery. Pure refactor — web still calls them synchronously, nothing breaks yet.
3. Worker: start the consumer loop + heartbeat alongside the watcher. (Worker can run jobs before web enqueues them — no empty-queue window.)
4. Web: flip `rescan`/`purge`/`empty` endpoints to enqueue; add `/api/activity`.
5. Web UI: `useActivity()` hook + aperture activity treatment + button pending states.
