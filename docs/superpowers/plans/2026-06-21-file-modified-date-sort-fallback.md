# File-modified date as a sort fallback — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `Photo.sortDate` a middle fallback (`takenAt ?? fileModifiedAt ?? now`) so EXIF-less photos sort by their file's modified date instead of import time, and surface that date in the lightbox sidebar.

**Architecture:** Add a readable `fileModifiedAt: DateTime NOT NULL` column derived from the file's mtime at ingest; keep the existing `fileMtimeMs: Float` as the exact change-detection fingerprint (tightened to `NOT NULL`). `storePhoto` derives `fileModifiedAt = new Date(fileMtimeMs)` and feeds it into `sortDate`. The content-unchanged restamp path updates the file-date columns but never `sortDate`. The migration wipes the (reconstructable) `Photo` table so the new `NOT NULL` columns add cleanly; the user reimports from disk afterward.

**Tech Stack:** TypeScript, Prisma 6 + Postgres, Vitest, Next.js (App Router), pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-06-21-file-modified-date-sort-fallback-design.md`

---

## File Map

| File | Change |
| --- | --- |
| `packages/db/prisma/schema.prisma` | `Photo`: add `fileModifiedAt DateTime`; flip `fileSize`/`fileMtimeMs` to non-null |
| `packages/db/prisma/migrations/20260621123000_add_file_modified_at/migration.sql` | **new** — wipe + add columns |
| `packages/ingest/src/store.ts` | derive `fileModifiedAt`; new `sortDate` fallback |
| `packages/ingest/src/store.test.ts` | tests for the fallback + derived column |
| `apps/worker/src/scan.ts` | `refreshStamp` writes `fileModifiedAt`; tighten `planScan`/`ScanRow` types |
| `apps/worker/src/scan.test.ts` | drop the obsolete legacy-null `planScan` case |
| `packages/shared/src/types.ts` | `PhotoDTO.fileModifiedAt: string \| null` |
| `packages/db/src/mappers.ts` | map `fileModifiedAt` in `toPhotoDTO` / `toTrashedPhotoDTO` |
| `packages/db/src/mappers.test.ts` | fixture + assertions for `fileModifiedAt` |
| `apps/web/src/components/photo-grid/lightbox-sidebar.tsx` | "File modified" `Row` |
| `apps/web/src/lib/photo-order.ts`, `apps/web/src/lib/calendar-service.ts` | update stale `sortDate` comments |

**Sequencing note:** Task 1 regenerates the Prisma client with the new/non-null columns, which leaves a TypeScript error in `store.ts`/`mappers.ts` until Tasks 2 and 4 land. That is expected — Vitest (esbuild) ignores type errors, so per-task test gates stay green. Do **not** run `next build` or reimport photos until Task 6.

---

## Task 1: Schema + destructive migration (wipe + NOT NULL columns)

> ⚠️ **DESTRUCTIVE, SHARED DATABASE.** Every Conductor worktree points at the *same* Postgres (`localhost:5433`, db `lumio`). The `DELETE` statements below empty the `Photo` table for **all** worktrees, not just this one. The user explicitly chose this wipe (spec option C). A subagent MUST NOT run the apply step (1.4) on its own — stage the files (1.1–1.3, 1.6) and let the **human** run the apply.
>
> Per project memory: the shared DB causes `prisma migrate dev` to see sibling branches' migrations as drift and offer a destructive reset. **Never** run `prisma migrate dev`, `migrate reset`, or any `--force`. Hand-write the SQL and apply with `migrate deploy`.

**Files:**
- Modify: `packages/db/prisma/schema.prisma:26-50` (the `Photo` model)
- Create: `packages/db/prisma/migrations/20260621123000_add_file_modified_at/migration.sql`

- [ ] **Step 1.1: Edit the `Photo` model in `schema.prisma`**

Change these three lines inside `model Photo` (currently at `schema.prisma:36-37`):

```prisma
  fileSize    Int? // bytes from fs.stat; nullable so existing rows migrate cleanly
  fileMtimeMs Float? // mtimeMs from fs.stat (fractional ms) — change-detection signal
```

to:

```prisma
  fileSize       Int // bytes from fs.stat
  fileMtimeMs    Float // mtimeMs from fs.stat (fractional ms) — exact change-detection fingerprint
  fileModifiedAt DateTime // readable mirror of fileMtimeMs; feeds sortDate's fallback chain
```

(Place `fileModifiedAt` immediately after `fileMtimeMs`. Leave every other field — `takenAt`, `sortDate`, indexes — unchanged.)

- [ ] **Step 1.2: Check migration status (read-only)**

Run: `pnpm --filter @lumio/db exec prisma migrate status`
Expected: reports applied migrations; the database is up to date with the existing migration folder (it may also note drift from sibling branches — that is the shared-DB situation; do NOT act on it, do NOT reset).

- [ ] **Step 1.3: Hand-write the migration SQL**

Create `packages/db/prisma/migrations/20260621123000_add_file_modified_at/migration.sql` with exactly:

```sql
-- file-stat columns become NOT NULL and a new fileModifiedAt is added. Existing
-- rows can't satisfy NOT NULL and are fully reconstructable from disk, so empty
-- the library first, then reimport (pnpm ingest) after this migration.
--
-- NOTE: this Postgres is shared across all Conductor worktrees; these DELETEs
-- wipe the Photo table everywhere. Intentional (spec option C).
DELETE FROM "Photo";          -- cascades to "AlbumPhoto" (onDelete: Cascade)
DELETE FROM "TrashedPhoto";   -- independent table; cleared for a full reset

-- AlterTable: add the readable mirror and tighten the fingerprint columns.
ALTER TABLE "Photo" ADD COLUMN "fileModifiedAt" TIMESTAMP(3) NOT NULL;
ALTER TABLE "Photo" ALTER COLUMN "fileSize" SET NOT NULL;
ALTER TABLE "Photo" ALTER COLUMN "fileMtimeMs" SET NOT NULL;
```

(Album *definitions* in the `Album` table are intentionally preserved; only photo rows and album *membership* are wiped.)

- [ ] **Step 1.4: Apply the migration (HUMAN-RUN, destructive)**

Run: `pnpm --filter @lumio/db exec prisma migrate deploy`
Expected: `Applying migration 20260621123000_add_file_modified_at` then `All migrations have been successfully applied.`

If `migrate deploy` reports the migration as already-failed or errors on drift, STOP and report — do not run `migrate dev` or `reset`.

- [ ] **Step 1.5: Regenerate the Prisma client**

Run: `pnpm db:generate`
Expected: `Generated Prisma Client`. After this, `Photo.fileModifiedAt` is typed `Date` and `fileSize`/`fileMtimeMs` are typed `number` (non-null).

- [ ] **Step 1.6: Verify the diff is clean, then commit**

Run: `git diff origin/main --name-only`
Expected: ONLY `packages/db/prisma/schema.prisma` and `packages/db/prisma/migrations/20260621123000_add_file_modified_at/migration.sql` (no sibling-branch migrations, no unrelated schema columns — see project memory on shared-DB contamination).

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260621123000_add_file_modified_at
git commit -m "feat(db): add fileModifiedAt; require fileSize/fileMtimeMs (wipe + reimport)"
```

---

## Task 2: `storePhoto` — derive `fileModifiedAt` and extend the `sortDate` fallback

**Files:**
- Modify: `packages/ingest/src/store.ts:29-45`
- Test: `packages/ingest/src/store.test.ts`

- [ ] **Step 2.1: Write the failing tests**

Add these two tests inside the `describe("storePhoto", …)` block in `packages/ingest/src/store.test.ts` (after the existing `it("upserts by path …")`):

```ts
  it("derives fileModifiedAt from fileMtimeMs and uses takenAt for sortDate when present", async () => {
    const db = fakeDb("p");
    await storePhoto(
      {
        path: "with-exif.jpg",
        source: PhotoSource.filesystem,
        processed, // processed.takenAt = 2024-03-14T09:26:53.000Z
        fileSize: 1,
        fileMtimeMs: 1710408413000.5,
      },
      { db: db as never, thumbnailsDir: path.join(dir, "te"), displaysDir: path.join(dir, "de") },
    );

    const args = db.calls[0] as {
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    expect(args.create.fileModifiedAt).toEqual(new Date(1710408413000.5));
    expect(args.update.fileModifiedAt).toEqual(new Date(1710408413000.5));
    // takenAt wins over the file date when EXIF has a capture date.
    expect(args.create.sortDate).toEqual(processed.takenAt);
    expect(args.update.sortDate).toEqual(processed.takenAt);
  });

  it("falls back to fileModifiedAt for sortDate when takenAt is null", async () => {
    const db = fakeDb("p");
    await storePhoto(
      {
        path: "no-exif.png",
        source: PhotoSource.filesystem,
        processed: { ...processed, takenAt: null },
        fileSize: 1,
        fileMtimeMs: 1710408413000.5,
      },
      { db: db as never, thumbnailsDir: path.join(dir, "tn"), displaysDir: path.join(dir, "dn") },
    );

    const args = db.calls[0] as { create: Record<string, unknown> };
    expect(args.create.sortDate).toEqual(new Date(1710408413000.5));
    expect(args.create.fileModifiedAt).toEqual(new Date(1710408413000.5));
  });
```

- [ ] **Step 2.2: Run the tests to verify they fail**

Run: `pnpm --filter @lumio/ingest exec vitest run src/store.test.ts`
Expected: FAIL — `args.create.fileModifiedAt` is `undefined` and `args.create.sortDate` equals `new Date()` (current `?? new Date()` fallback), not the file date.

- [ ] **Step 2.3: Implement the change in `store.ts`**

Replace the destructuring + `data` object (`store.ts:29-45`) with:

```ts
  const { path: relPath, source, processed, fileSize, fileMtimeMs } = input;

  // The file's modified date, as a readable mirror of the raw `fileMtimeMs`
  // fingerprint. mtime is POSIX-guaranteed, so this is always a valid Date.
  const fileModifiedAt = new Date(fileMtimeMs);

  // `source` records how a photo first entered the system (provenance), so it
  // is set on create only. Re-ingestion of the same path — e.g. the filesystem
  // watcher picking up a freshly uploaded file — must NOT overwrite an upload's
  // source back to `filesystem`.
  const data = {
    takenAt: processed.takenAt,
    // Chronology for the "taken" sorts: the EXIF capture date when present,
    // otherwise the file's modified date. fileModifiedAt is always set, so there
    // is no import-time floor (a genuine re-import re-derives this from the new
    // file; the content-unchanged restamp path leaves it alone — see scan.ts).
    sortDate: processed.takenAt ?? fileModifiedAt,
    width: processed.width,
    height: processed.height,
    hash: processed.hash,
    thumbhash: processed.thumbhash,
    exif: processed.exif as object,
    fileSize,
    fileMtimeMs,
    fileModifiedAt,
  };
```

(Leave the `db.photo.upsert(...)` call and the rendition writes below it unchanged.)

- [ ] **Step 2.4: Run the tests to verify they pass**

Run: `pnpm --filter @lumio/ingest exec vitest run src/store.test.ts`
Expected: PASS (all `storePhoto` tests, including the two new ones).

- [ ] **Step 2.5: Commit**

```bash
git add packages/ingest/src/store.ts packages/ingest/src/store.test.ts
git commit -m "feat(ingest): file-modified date feeds sortDate fallback"
```

---

## Task 3: Scan path — restamp writes `fileModifiedAt`; tighten stat types

**Files:**
- Modify: `apps/worker/src/scan.ts:49-58` (`planScan`), `:91-98` (`ScanRow`), `:118-122` (`refreshStamp`)
- Test: `apps/worker/src/scan.test.ts`

- [ ] **Step 3.1: Update the `planScan` tests (drop the obsolete legacy-null case)**

In `apps/worker/src/scan.test.ts`, delete this test (it asserts behavior for `fileSize: null`/`fileMtimeMs: null` rows, which can no longer exist now that those columns are `NOT NULL` and would be a type error):

```ts
  it("is 'check-hash' for a legacy row with null stats", () => {
    expect(planScan({ fileSize: null, fileMtimeMs: null }, st, true)).toBe("check-hash");
  });
```

- [ ] **Step 3.2: Run the suite to confirm it still compiles/passes after the deletion**

Run: `pnpm --filter @lumio/worker exec vitest run src/scan.test.ts`
Expected: PASS (remaining `planScan`/`planAfterHash`/`reconcileDeletions` tests).

- [ ] **Step 3.3: Tighten `planScan` and `ScanRow` to non-null stats**

In `apps/worker/src/scan.ts`, change the `planScan` signature (`scan.ts:50`):

```ts
export function planScan(
  row: { fileSize: number; fileMtimeMs: number } | undefined,
  st: { size: number; mtimeMs: number },
  cacheExists: boolean,
): ScanPlan {
```

and the `ScanRow` interface (`scan.ts:91-98`):

```ts
export interface ScanRow {
  id: string;
  path: string;
  fileSize: number;
  fileMtimeMs: number;
  hash: string | null;
  edits: unknown;
}
```

(`SCAN_SELECT` is unchanged — it already selects `fileSize` and `fileMtimeMs`, now typed non-null by the regenerated client.)

- [ ] **Step 3.4: Add `fileModifiedAt` to `refreshStamp`**

Replace the `refreshStamp` body (`scan.ts:118-122`) with:

```ts
async function refreshStamp(id: string, st: { size: number; mtimeMs: number }): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "Photo"
    SET "fileSize" = ${st.size},
        "fileMtimeMs" = ${st.mtimeMs},
        "fileModifiedAt" = ${new Date(st.mtimeMs)}
    WHERE "id" = ${id}
  `;
}
```

Keep the existing doc-comment above it; append one sentence: ` It updates the file-date columns to track the touched file but deliberately leaves "sortDate" untouched — a touch that doesn't change pixels must not reorder the photo.`

- [ ] **Step 3.5: Run the worker tests**

Run: `pnpm --filter @lumio/worker exec vitest run`
Expected: PASS.

> No unit test covers `refreshStamp` directly: it issues a raw SQL `UPDATE`, and this codebase has no DB-integration test harness (all tests are pure functions or use fakes/tmpdirs). Its correctness — file-date columns move, `sortDate` and `updatedAt` stay put — is verified manually in Task 6 against the running app.

- [ ] **Step 3.6: Commit**

```bash
git add apps/worker/src/scan.ts apps/worker/src/scan.test.ts
git commit -m "feat(worker): restamp writes fileModifiedAt; require stat columns"
```

---

## Task 4: `PhotoDTO` + mappers expose `fileModifiedAt`

**Files:**
- Modify: `packages/shared/src/types.ts:21-38` (`PhotoDTO`)
- Modify: `packages/db/src/mappers.ts:12-48`
- Test: `packages/db/src/mappers.test.ts`

- [ ] **Step 4.1: Add the field to `PhotoDTO`**

In `packages/shared/src/types.ts`, add a line to the `PhotoDTO` interface immediately after `takenAt` (`types.ts:25`):

```ts
  takenAt: string | null; // ISO string
  fileModifiedAt: string | null; // ISO string; null for trashed photos (no such column)
```

- [ ] **Step 4.2: Write the failing mapper tests**

In `packages/db/src/mappers.test.ts`:

(a) Add `fileModifiedAt` to `baseRow` and make the stat fields realistic (`baseRow` at `mappers.test.ts:5-23`), replacing its `fileSize`/`fileMtimeMs` lines:

```ts
  fileSize: 12345,
  fileMtimeMs: 1710408413000.5,
  fileModifiedAt: new Date("2024-01-20T08:00:00.000Z"),
```

(b) Add an assertion to the first `toPhotoDTO` test (`it("maps a Prisma photo row …")`):

```ts
    expect(dto.fileModifiedAt).toBe("2024-01-20T08:00:00.000Z");
```

(c) Add an assertion to the `toTrashedPhotoDTO` test (after `expect(dto.updatedAt)…`):

```ts
    expect(dto.fileModifiedAt).toBeNull();
```

- [ ] **Step 4.3: Run the tests to verify they fail**

Run: `pnpm --filter @lumio/db exec vitest run src/mappers.test.ts`
Expected: FAIL — `dto.fileModifiedAt` is `undefined` (mappers don't set it yet).

- [ ] **Step 4.4: Implement the mappers**

In `packages/db/src/mappers.ts`, add to the `toPhotoDTO` return object (after the `takenAt` line, `mappers.ts:17`):

```ts
    takenAt: row.takenAt ? row.takenAt.toISOString() : null,
    fileModifiedAt: row.fileModifiedAt.toISOString(),
```

and add to the `toTrashedPhotoDTO` return object (after its `takenAt` line, `mappers.ts:36`):

```ts
    takenAt: row.takenAt ? row.takenAt.toISOString() : null,
    fileModifiedAt: null, // TrashedPhoto has no file-stat columns
```

- [ ] **Step 4.5: Run the tests to verify they pass**

Run: `pnpm --filter @lumio/db exec vitest run src/mappers.test.ts`
Expected: PASS.

- [ ] **Step 4.6: Commit**

```bash
git add packages/shared/src/types.ts packages/db/src/mappers.ts packages/db/src/mappers.test.ts
git commit -m "feat(db): expose fileModifiedAt on PhotoDTO"
```

---

## Task 5: Lightbox sidebar — "File modified" row

**Files:**
- Modify: `apps/web/src/components/photo-grid/lightbox-sidebar.tsx:51-57` (the Info tab's first `Row` group)

- [ ] **Step 5.1: Add the row**

In `lightbox-sidebar.tsx`, inside `<TabsContent value="info" …>`, add a `Row` directly after the "Taken" row (`lightbox-sidebar.tsx:54`):

```tsx
              <Row label="Source" value={<Badge>{photo.source}</Badge>} />
              <Row label="Taken" value={photo.takenAt ?? "—"} />
              <Row label="File modified" value={photo.fileModifiedAt ?? "—"} />
              <Row label="Camera" value={camera} />
              <Row label="Hash" value={photo.hash ?? "—"} />
```

(Raw ISO value to match the existing "Taken" row; prettier formatting is explicitly out of scope per the spec.)

- [ ] **Step 5.2: Commit**

```bash
git add apps/web/src/components/photo-grid/lightbox-sidebar.tsx
git commit -m "feat(web): show file-modified date in lightbox info"
```

---

## Task 6: Update stale comments, full verification, reimport

**Files:**
- Modify: `apps/web/src/lib/photo-order.ts:6`, `apps/web/src/lib/calendar-service.ts:17`

- [ ] **Step 6.1: Update the `photo-order.ts` comment**

In `apps/web/src/lib/photo-order.ts`, change the sentence in the doc-comment that reads:

```
 * `sortDate` is `takenAt ?? importTime` (set at ingest), so the taken-date sorts
 * keep EXIF-less photos chronological by their import time. Shared by the
```

to:

```
 * `sortDate` is `takenAt ?? fileModifiedAt` (set at ingest), so the taken-date
 * sorts keep EXIF-less photos chronological by their file's modified date. Shared by the
```

- [ ] **Step 6.2: Update the `calendar-service.ts` comment**

In `apps/web/src/lib/calendar-service.ts`, change the phrase `Grouping is by \`sortDate\` (takenAt ?? import time) in UTC` (around `:17`) to `Grouping is by \`sortDate\` (takenAt ?? file-modified date) in UTC`.

- [ ] **Step 6.3: Run the full test suite**

Run: `pnpm -r test`
Expected: PASS across all packages (`@lumio/db`, `@lumio/ingest`, `@lumio/worker`, `@lumio/web`, `@lumio/shared`).

- [ ] **Step 6.4: Build the web app (the real type gate — `tsc --noEmit` is NOT usable here per project memory)**

Run: `pnpm --filter @lumio/web build`
Expected: build succeeds — confirms `PhotoDTO`'s new required field is satisfied at every construction site and the sidebar typechecks.

- [ ] **Step 6.5: Lint the web app**

Run: `pnpm --filter @lumio/web exec next lint`
Expected: no new errors (the React-Compiler rules apply; the sidebar change only adds a static `Row`).

- [ ] **Step 6.6: Commit the comment fixes**

```bash
git add apps/web/src/lib/photo-order.ts apps/web/src/lib/calendar-service.ts
git commit -m "docs: sortDate fallback now includes file-modified date"
```

- [ ] **Step 6.7: Reimport the library (HUMAN-RUN) and verify behavior**

The migration emptied `Photo`. Repopulate from disk:

Run: `pnpm ingest`
Expected: every on-disk image is processed (`processed …` lines); no errors.

Then manually verify (per the spec's behavior section):
1. Open the app (`pnpm dev`), open a photo **without** EXIF (e.g. a screenshot/PNG) in the lightbox → the **Info** tab shows a "File modified" date, and the grid's "taken" sort places it by that date rather than bunched at "now".
2. `touch` an already-imported file and run `pnpm ingest` again → the worker logs it as `restamped` (not `processed`); the photo's position in the "taken" sort is unchanged (sortDate frozen), and its lightbox thumbnail does not flash a cache-bust (updatedAt untouched).
3. A photo **with** EXIF still sorts by its capture date (`takenAt`), unaffected.

---

## Self-Review

- **Spec coverage:** data model (Task 1) ✓; `sortDate` fallback + derive `fileModifiedAt` (Task 2) ✓; restamp updates file-date but not `sortDate`, re-import re-derives both (Tasks 2+3) ✓; fingerprint comparison unchanged (Task 3 keeps the float `===`) ✓; `NOT NULL` tightening + dropped `| null` handling (Tasks 1+3) ✓; migration wipe + reimport (Tasks 1+6) ✓; sidebar display with DTO/mapper plumbing (Tasks 4+5) ✓; stale comment updates (Tasks 2+6) ✓; tests for store/mappers (Tasks 2+4) ✓.
- **Deviations from spec (intentional):** (1) `fileModifiedAt` is derived inside `storePhoto` from the already-passed `fileMtimeMs` rather than plumbed separately through `ingest.ts` → DRY, no `StoreInput` change. (2) `sortDate` is written `takenAt ?? fileModifiedAt` without a trailing `?? now`: `fileModifiedAt` is always present, so `?? now` would be dead code. (3) The spec's `scan.test.ts` "restamp" unit test is replaced by manual verification (Step 6.7) — no DB-integration harness exists in this repo; only pure functions are unit-tested.
- **Type consistency:** `fileModifiedAt` is `DateTime`(Prisma)/`Date`(runtime)/`string | null`(DTO) consistently; `planScan`/`ScanRow` both move to non-null `number`; `refreshStamp` writes a `Date` into the `TIMESTAMP(3)` column.
- **Placeholders:** none.
