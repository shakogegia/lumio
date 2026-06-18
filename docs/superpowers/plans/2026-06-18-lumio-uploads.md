# Lumio Uploads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a drag-and-drop upload page that files photos into `/photos` using a configurable folder template, dedups by content hash, and ingests each file synchronously so it appears in the library immediately.

**Architecture:** Extract the trigger-agnostic ingestion pipeline out of `apps/worker` into a new shared package `@lumio/ingest`, consumed by both the worker (scan/watch) and the web upload route. The web route buffers each file, checks the sha256 hash for duplicates, derives a date (EXIF → file mtime → now), renders the configured template to a collision-safe path under `/photos`, writes the original, and runs the shared `ingestPath`. The template lives in a single-row Postgres `AppSettings` table edited in Settings.

**Tech Stack:** pnpm monorepo, TypeScript (ESM, `verbatimModuleSyntax`, `noUncheckedIndexedAccess`), Next.js 16 App Router (`--webpack`), Prisma + Postgres, sharp + exifr + external `djxl`/`sips` decoders, Zod, Vitest.

---

## File Structure

**New package `packages/ingest`** (moved + new pipeline code):
- `package.json`, `tsconfig.json`, `vitest.config.ts` — scaffold.
- `src/constants.ts` — `SUPPORTED_EXTENSIONS`, `THUMBNAIL_MAX`, `DISPLAY_MAX` (moved from worker `config.ts`).
- `src/decode.ts` (+ `decode.test.ts`) — moved unchanged from `apps/worker/src/pipeline/`.
- `src/process.ts` (+ `process.test.ts`) — moved; import path for constants changes.
- `src/store.ts` (+ `store.test.ts`) — moved unchanged.
- `src/ingest.ts` (+ `ingest.test.ts`) — moved; `ingestPath` gains a `source` param and returns `{ id }`; deps become required.
- `src/find-by-hash.ts` (+ test) — new `findPhotoByHash`.
- `src/place-upload.ts` (+ test) — new collision-safe `placeUpload`.
- `src/upload-date.ts` (+ test) — new `extractUploadDate`.
- `src/index.ts` — barrel export.

**`apps/worker`** (re-point to the package):
- `src/config.ts` — drop the moved constants; keep dir resolution.
- `src/deps.ts` — new: bundles `ingestDeps`/`removeDeps` from config + prisma.
- `src/scan.ts`, `src/watch.ts` — import from `@lumio/ingest`, pass deps explicitly.
- `package.json` — add `@lumio/ingest`.
- Deleted: `src/ingest.ts`, `src/ingest.test.ts`, `src/pipeline/*` (moved).

**`packages/shared`**:
- `src/uploads.ts` (+ `uploads.test.ts`) — `renderTemplate`, `validateTemplate`, `DEFAULT_UPLOAD_TEMPLATE`, `updateSettingsSchema`.
- `src/index.ts` — export `./uploads.js`.

**`packages/db`**:
- `prisma/schema.prisma` — add `AppSettings` model.
- `src/settings.ts` (+ `settings.test.ts`) — `getSettings`, `updateSettings`.
- `src/index.ts` — export `./settings.js`.

**`apps/web`**:
- `src/lib/upload-service.ts` (+ `upload-service.test.ts`) — `handleUpload` orchestration.
- `src/app/api/uploads/route.ts` — `POST` handler.
- `src/app/api/settings/route.ts` — `PUT` handler.
- `src/app/upload/page.tsx` + `src/app/upload/upload-client.tsx` — drop zone + queue.
- `src/app/settings/page.tsx` — add Uploads card.
- `src/app/settings/upload-template-form.tsx` — new client form.
- `src/components/app-sidebar.tsx` — add Upload nav item.
- `next.config.ts` — transpile `@lumio/ingest`, externalize `sharp`.
- `package.json` — add `@lumio/ingest`.

---

## Task 1: Extract the ingestion pipeline into `@lumio/ingest`

Pure refactor — no behaviour change. Checkpoint: every existing test still passes.

**Files:**
- Create: `packages/ingest/package.json`, `packages/ingest/tsconfig.json`, `packages/ingest/vitest.config.ts`, `packages/ingest/src/constants.ts`, `packages/ingest/src/index.ts`
- Move: `apps/worker/src/pipeline/{decode,process,store}.ts` + their `.test.ts`, `apps/worker/src/ingest.ts` + `ingest.test.ts` → `packages/ingest/src/`
- Modify: `packages/ingest/src/process.ts`, `packages/ingest/src/ingest.ts`, `apps/worker/src/config.ts`, `apps/worker/src/scan.ts`, `apps/worker/src/watch.ts`, `apps/worker/package.json`
- Create: `apps/worker/src/deps.ts`

- [ ] **Step 1: Scaffold the package**

Create `packages/ingest/package.json`:

```json
{
  "name": "@lumio/ingest",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "TZ=UTC vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@lumio/db": "workspace:*",
    "@lumio/shared": "workspace:*",
    "exifr": "^7",
    "sharp": "^0.33"
  },
  "devDependencies": {
    "@types/node": "^22"
  }
}
```

Create `packages/ingest/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src"]
}
```

Create `packages/ingest/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node" },
});
```

- [ ] **Step 2: Create the constants module**

Create `packages/ingest/src/constants.ts`:

```ts
/** Build-time thumbnail max edge (px). Changing this requires regenerating the cache. */
export const THUMBNAIL_MAX = 400;

/**
 * Build-time display-rendition max edge (px). The detail view renders this
 * instead of the original so non-browser formats (JXL/HEIC) display, and large
 * originals don't ship megabytes per view. Changing this requires regenerating
 * the cache.
 */
export const DISPLAY_MAX = 2048;

/** Image extensions the pipeline ingests. */
export const SUPPORTED_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".jxl",
  ".heic",
  ".heif",
]);
```

- [ ] **Step 3: Move the pipeline files**

```bash
git mv apps/worker/src/pipeline/decode.ts packages/ingest/src/decode.ts
git mv apps/worker/src/pipeline/decode.test.ts packages/ingest/src/decode.test.ts
git mv apps/worker/src/pipeline/process.ts packages/ingest/src/process.ts
git mv apps/worker/src/pipeline/process.test.ts packages/ingest/src/process.test.ts
git mv apps/worker/src/pipeline/store.ts packages/ingest/src/store.ts
git mv apps/worker/src/pipeline/store.test.ts packages/ingest/src/store.test.ts
git mv apps/worker/src/ingest.ts packages/ingest/src/ingest.ts
git mv apps/worker/src/ingest.test.ts packages/ingest/src/ingest.test.ts
rmdir apps/worker/src/pipeline
```

- [ ] **Step 4: Fix `process.ts` constant import**

In `packages/ingest/src/process.ts`, change the constants import from the old worker config path to the new local module. Replace:

```ts
import { DISPLAY_MAX, THUMBNAIL_MAX } from "../config.js";
```

with:

```ts
import { DISPLAY_MAX, THUMBNAIL_MAX } from "./constants.js";
```

(The `import { decodeToReadable } from "./decode.js";` line is already correct — `decode.ts` is now a sibling.)

- [ ] **Step 5: Rewrite `ingest.ts` (required deps, `source` param, returns id)**

Replace the entire contents of `packages/ingest/src/ingest.ts` with:

```ts
import { rm } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@lumio/db";
import { PhotoSource } from "@lumio/shared";
import { processImage } from "./process.js";
import { storePhoto } from "./store.js";

export interface IngestDeps {
  db: Pick<PrismaClient, "photo">;
  thumbnailsDir: string;
  displaysDir: string;
  photosDir: string;
}

/** Process the file at `<photosDir>/<relPath>` and upsert it. Returns the photo id. */
export async function ingestPath(
  relPath: string,
  deps: IngestDeps,
  source: PhotoSource = PhotoSource.filesystem,
): Promise<{ id: string }> {
  const processed = await processImage(path.join(deps.photosDir, relPath));
  return storePhoto(
    { path: relPath, source, processed },
    { db: deps.db, thumbnailsDir: deps.thumbnailsDir, displaysDir: deps.displaysDir },
  );
}

export interface RemoveDeps {
  db: Pick<PrismaClient, "photo">;
  thumbnailsDir: string;
  displaysDir: string;
}

export async function removePath(relPath: string, deps: RemoveDeps): Promise<void> {
  const found = await deps.db.photo.findUnique({ where: { path: relPath }, select: { id: true } });
  if (!found) return;
  await deps.db.photo.delete({ where: { id: found.id } });
  await rm(path.join(deps.thumbnailsDir, `${found.id}.webp`), { force: true });
  await rm(path.join(deps.displaysDir, `${found.id}.webp`), { force: true });
}
```

- [ ] **Step 6: Create the barrel export**

Create `packages/ingest/src/index.ts`:

```ts
export * from "./constants.js";
export * from "./decode.js";
export * from "./process.js";
export * from "./store.js";
export * from "./ingest.js";
```

- [ ] **Step 7: Trim worker `config.ts`**

In `apps/worker/src/config.ts`, remove the three moved constants (`THUMBNAIL_MAX`, `DISPLAY_MAX`, `SUPPORTED_EXTENSIONS`) and their comments. Keep `PHOTOS_DIR`, `CACHE_DIR`, `THUMBNAILS_DIR`, `DISPLAYS_DIR`, `thumbnailPath`, `displayPath`. The file should end up as:

```ts
import path from "node:path";
import { fileURLToPath } from "node:url";

// This file lives at apps/worker/src/config.ts → repo root is three levels up.
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

function resolveFromRoot(value: string | undefined, fallback: string): string {
  return path.resolve(REPO_ROOT, value ?? fallback);
}

/** Absolute path to the source-of-truth originals directory. */
export const PHOTOS_DIR = resolveFromRoot(process.env.PHOTOS_DIR, "./photos");

/** Absolute path to the regenerable cache root. */
export const CACHE_DIR = resolveFromRoot(process.env.CACHE_DIR, "./cache");

export const THUMBNAILS_DIR = path.join(CACHE_DIR, "thumbnails");

export const DISPLAYS_DIR = path.join(CACHE_DIR, "displays");

/** Absolute path of a photo's thumbnail file. */
export function thumbnailPath(id: string): string {
  return path.join(THUMBNAILS_DIR, `${id}.webp`);
}

/** Absolute path of a photo's display rendition. */
export function displayPath(id: string): string {
  return path.join(DISPLAYS_DIR, `${id}.webp`);
}
```

- [ ] **Step 8: Add worker `deps.ts`**

Create `apps/worker/src/deps.ts`:

```ts
import { prisma } from "@lumio/db";
import type { IngestDeps, RemoveDeps } from "@lumio/ingest";
import { DISPLAYS_DIR, PHOTOS_DIR, THUMBNAILS_DIR } from "./config.js";

export const ingestDeps: IngestDeps = {
  db: prisma,
  photosDir: PHOTOS_DIR,
  thumbnailsDir: THUMBNAILS_DIR,
  displaysDir: DISPLAYS_DIR,
};

export const removeDeps: RemoveDeps = {
  db: prisma,
  thumbnailsDir: THUMBNAILS_DIR,
  displaysDir: DISPLAYS_DIR,
};
```

- [ ] **Step 9: Re-point `scan.ts`**

In `apps/worker/src/scan.ts`, update the imports and the two pipeline calls. Change the import block to:

```ts
import { readdir } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@lumio/db";
import { SUPPORTED_EXTENSIONS, ingestPath, removePath } from "@lumio/ingest";
import { PHOTOS_DIR } from "./config.js";
import { ingestDeps, removeDeps } from "./deps.js";
```

Change `await ingestPath(relPath);` to `await ingestPath(relPath, ingestDeps);` and `await removePath(row.path);` to `await removePath(row.path, removeDeps);`.

- [ ] **Step 10: Re-point `watch.ts`**

In `apps/worker/src/watch.ts`, change the import block to:

```ts
import path from "node:path";
import chokidar from "chokidar";
import { prisma } from "@lumio/db";
import { SUPPORTED_EXTENSIONS, ingestPath, removePath } from "@lumio/ingest";
import { PHOTOS_DIR } from "./config.js";
import { ingestDeps, removeDeps } from "./deps.js";
import { scanAndIngest } from "./scan.js";
```

Change `await ingestPath(rel);` to `await ingestPath(rel, ingestDeps);` and `await removePath(rel);` to `await removePath(rel, removeDeps);`.

- [ ] **Step 11: Add the worker dependency + install**

In `apps/worker/package.json`, add to `dependencies` (keep `sharp`/`exifr` — `scripts/seed-photos.ts` still uses `sharp`):

```json
    "@lumio/ingest": "workspace:*",
```

Then:

Run: `pnpm install`
Expected: completes; links `@lumio/ingest` into the workspace.

- [ ] **Step 12: Verify the move — all tests + typecheck green**

Run: `pnpm -r test`
Expected: PASS — the moved tests now run under `@lumio/ingest`; worker keeps only `scan.test.ts`; shared/db/web unchanged. Total still 46.

Run: `pnpm -r typecheck`
Expected: PASS for every package.

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "refactor: extract ingestion pipeline into @lumio/ingest"
```

---

## Task 2: `findPhotoByHash`

**Files:**
- Create: `packages/ingest/src/find-by-hash.ts`, `packages/ingest/src/find-by-hash.test.ts`
- Modify: `packages/ingest/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/ingest/src/find-by-hash.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { findPhotoByHash } from "./find-by-hash.js";

function fakeDb(result: { id: string } | null) {
  const calls: unknown[] = [];
  return {
    calls,
    photo: {
      findFirst: async (args: unknown) => {
        calls.push(args);
        return result;
      },
    },
  };
}

describe("findPhotoByHash", () => {
  it("returns the existing photo when the hash matches", async () => {
    const db = fakeDb({ id: "p1" });
    const found = await findPhotoByHash("abc", db as never);
    expect(found).toEqual({ id: "p1" });
    expect(db.calls[0]).toEqual({ where: { hash: "abc" }, select: { id: true } });
  });

  it("returns null when no photo matches", async () => {
    const db = fakeDb(null);
    expect(await findPhotoByHash("missing", db as never)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lumio/ingest test find-by-hash`
Expected: FAIL — cannot find module `./find-by-hash.js`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/ingest/src/find-by-hash.ts`:

```ts
import type { PrismaClient } from "@lumio/db";

/** Find an already-indexed photo with the same content hash, if any. */
export async function findPhotoByHash(
  hash: string,
  db: Pick<PrismaClient, "photo">,
): Promise<{ id: string } | null> {
  return db.photo.findFirst({ where: { hash }, select: { id: true } });
}
```

- [ ] **Step 4: Export it** — add to `packages/ingest/src/index.ts`:

```ts
export * from "./find-by-hash.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @lumio/ingest test find-by-hash`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/ingest/src/find-by-hash.ts packages/ingest/src/find-by-hash.test.ts packages/ingest/src/index.ts
git commit -m "feat(ingest): findPhotoByHash for upload dedup"
```

---

## Task 3: `placeUpload` (collision-safe write)

**Files:**
- Create: `packages/ingest/src/place-upload.ts`, `packages/ingest/src/place-upload.test.ts`
- Modify: `packages/ingest/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/ingest/src/place-upload.test.ts`:

```ts
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { placeUpload } from "./place-upload.js";

const photosDir = await mkdtemp(path.join(tmpdir(), "lumio-place-"));
afterAll(async () => rm(photosDir, { recursive: true, force: true }));

describe("placeUpload", () => {
  it("writes the bytes to the requested relative path", async () => {
    const rel = await placeUpload({
      bytes: Buffer.from("hello"),
      relPath: "2024/2024-03-14/a.jpg",
      photosDir,
    });
    expect(rel).toBe("2024/2024-03-14/a.jpg");
    expect(await readFile(path.join(photosDir, rel), "utf8")).toBe("hello");
  });

  it("suffixes the filename when the target already exists", async () => {
    await writeFile(path.join(photosDir, "dup.jpg"), "first");
    const rel = await placeUpload({ bytes: Buffer.from("second"), relPath: "dup.jpg", photosDir });
    expect(rel).toBe("dup-1.jpg");
    expect(await readFile(path.join(photosDir, "dup.jpg"), "utf8")).toBe("first");
    expect(await readFile(path.join(photosDir, "dup-1.jpg"), "utf8")).toBe("second");
  });

  it("rejects path traversal", async () => {
    await expect(
      placeUpload({ bytes: Buffer.from("x"), relPath: "../escape.jpg", photosDir }),
    ).rejects.toThrow("Path traversal blocked");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lumio/ingest test place-upload`
Expected: FAIL — cannot find module `./place-upload.js`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/ingest/src/place-upload.ts`:

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { access } from "node:fs/promises";
import path from "node:path";

async function exists(absPath: string): Promise<boolean> {
  try {
    await access(absPath);
    return true;
  } catch {
    return false;
  }
}

export interface PlaceUploadInput {
  bytes: Buffer;
  /** POSIX-style relative path under photosDir (e.g. "2024/2024-03-14/IMG.jpg"). */
  relPath: string;
  photosDir: string;
}

/**
 * Write `bytes` under `photosDir` at `relPath`. If the target exists, append
 * "-1", "-2", … to the filename stem until a free name is found. Returns the
 * final relative path actually written. Blocks path traversal.
 */
export async function placeUpload(input: PlaceUploadInput): Promise<string> {
  const { bytes, relPath, photosDir } = input;
  const resolvedRoot = path.resolve(photosDir);
  const desired = path.resolve(resolvedRoot, relPath);
  if (desired !== resolvedRoot && !desired.startsWith(resolvedRoot + path.sep)) {
    throw new Error("Path traversal blocked");
  }

  const dir = path.dirname(desired);
  const ext = path.extname(desired);
  const stem = path.basename(desired, ext);

  let candidate = desired;
  let n = 0;
  while (await exists(candidate)) {
    n += 1;
    candidate = path.join(dir, `${stem}-${n}${ext}`);
  }

  await mkdir(path.dirname(candidate), { recursive: true });
  await writeFile(candidate, bytes);
  return path.relative(resolvedRoot, candidate).split(path.sep).join("/");
}
```

- [ ] **Step 4: Export it** — add to `packages/ingest/src/index.ts`:

```ts
export * from "./place-upload.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @lumio/ingest test place-upload`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/ingest/src/place-upload.ts packages/ingest/src/place-upload.test.ts packages/ingest/src/index.ts
git commit -m "feat(ingest): collision-safe placeUpload"
```

---

## Task 4: `extractUploadDate`

Date precedence: EXIF `DateTimeOriginal`/`CreateDate` → file `lastModified` → `now`.

**Files:**
- Create: `packages/ingest/src/upload-date.ts`, `packages/ingest/src/upload-date.test.ts`
- Modify: `packages/ingest/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/ingest/src/upload-date.test.ts` (the package runs with `TZ=UTC`):

```ts
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { extractUploadDate } from "./upload-date.js";

async function jpegWithExif(): Promise<Buffer> {
  return sharp({ create: { width: 8, height: 8, channels: 3, background: "#222" } })
    .withExif({ IFD2: { DateTimeOriginal: "2024:03:14 09:26:53" } })
    .jpeg()
    .toBuffer();
}

async function jpegNoExif(): Promise<Buffer> {
  return sharp({ create: { width: 8, height: 8, channels: 3, background: "#222" } })
    .jpeg()
    .toBuffer();
}

describe("extractUploadDate", () => {
  it("uses EXIF DateTimeOriginal when present", async () => {
    const date = await extractUploadDate(await jpegWithExif(), undefined, new Date("2030-01-01T00:00:00Z"));
    expect(date.getUTCFullYear()).toBe(2024);
    expect(date.getUTCMonth() + 1).toBe(3);
    expect(date.getUTCDate()).toBe(14);
  });

  it("falls back to lastModified when EXIF has no date", async () => {
    const lastModified = Date.UTC(2023, 4, 20); // 2023-05-20
    const date = await extractUploadDate(await jpegNoExif(), lastModified, new Date("2030-01-01T00:00:00Z"));
    expect(date.getTime()).toBe(lastModified);
  });

  it("falls back to now when neither EXIF nor lastModified is available", async () => {
    const now = new Date("2030-01-01T00:00:00Z");
    const date = await extractUploadDate(await jpegNoExif(), undefined, now);
    expect(date.getTime()).toBe(now.getTime());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lumio/ingest test upload-date`
Expected: FAIL — cannot find module `./upload-date.js`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/ingest/src/upload-date.ts`:

```ts
import exifr from "exifr";

function parseDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  return null;
}

/**
 * Decide the date used to file an upload: EXIF DateTimeOriginal/CreateDate,
 * else the client-provided lastModified, else `now`.
 */
export async function extractUploadDate(
  bytes: Buffer,
  lastModified: number | undefined,
  now: Date,
): Promise<Date> {
  const raw = (await exifr.parse(bytes).catch(() => null)) ?? {};
  const exifDate = parseDate(raw.DateTimeOriginal) ?? parseDate(raw.CreateDate);
  if (exifDate) return exifDate;
  if (typeof lastModified === "number" && Number.isFinite(lastModified)) {
    return new Date(lastModified);
  }
  return now;
}
```

- [ ] **Step 4: Export it** — add to `packages/ingest/src/index.ts`:

```ts
export * from "./upload-date.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @lumio/ingest test upload-date`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/ingest/src/upload-date.ts packages/ingest/src/upload-date.test.ts packages/ingest/src/index.ts
git commit -m "feat(ingest): extractUploadDate (EXIF → mtime → now)"
```

---

## Task 5: Template engine in `@lumio/shared`

`renderTemplate` formats date components in **UTC** for determinism. `{filename}` = sanitized original filename including extension; `{ext}` = extension without the dot.

**Files:**
- Create: `packages/shared/src/uploads.ts`, `packages/shared/src/uploads.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/uploads.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_UPLOAD_TEMPLATE, renderTemplate, validateTemplate } from "./uploads.js";

const date = new Date("2024-03-14T09:26:53.000Z");

describe("renderTemplate", () => {
  it("renders the default year/day/filename layout", () => {
    expect(renderTemplate(DEFAULT_UPLOAD_TEMPLATE, { date, originalFilename: "IMG_1234.JPG" }))
      .toBe("2024/2024-03-14/IMG_1234.JPG");
  });

  it("supports the {ext} token", () => {
    expect(renderTemplate("{YYYY}/{MM}/{DD}.{ext}", { date, originalFilename: "p.png" }))
      .toBe("2024/03/14.png");
  });

  it("sanitizes path separators and control chars out of the filename", () => {
    expect(renderTemplate("{filename}", { date, originalFilename: "a/b\\c .jpg" }))
      .toBe("a_b_c_.jpg");
  });
});

describe("validateTemplate", () => {
  it("accepts a template containing {filename}", () => {
    expect(validateTemplate(DEFAULT_UPLOAD_TEMPLATE)).toEqual({ ok: true });
  });

  it("accepts a template containing {ext}", () => {
    expect(validateTemplate("{YYYY}/{MM}/{DD}.{ext}")).toEqual({ ok: true });
  });

  it("rejects empty templates", () => {
    expect(validateTemplate("   ").ok).toBe(false);
  });

  it("rejects templates without {filename} or {ext}", () => {
    expect(validateTemplate("{YYYY}/{MM}/{DD}").ok).toBe(false);
  });

  it("rejects '..' segments", () => {
    expect(validateTemplate("../{filename}").ok).toBe(false);
  });

  it("rejects a leading slash", () => {
    expect(validateTemplate("/{filename}").ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lumio/shared test uploads`
Expected: FAIL — cannot find module `./uploads.js`.

- [ ] **Step 3: Write minimal implementation**

Create `packages/shared/src/uploads.ts`:

```ts
import { z } from "zod";

export const DEFAULT_UPLOAD_TEMPLATE = "{YYYY}/{YYYY}-{MM}-{DD}/{filename}";

const pad = (n: number): string => String(n).padStart(2, "0");

/** Replace path separators and whitespace in an uploaded filename with underscores. */
function sanitizeFilename(name: string): string {
  return name.replace(/[/\\\s]/g, "_");
}

export interface TemplateContext {
  date: Date;
  originalFilename: string;
}

/** Render a token template into a POSIX relative path. Date parts are UTC. */
export function renderTemplate(template: string, ctx: TemplateContext): string {
  const filename = sanitizeFilename(ctx.originalFilename);
  const dot = filename.lastIndexOf(".");
  const ext = dot > 0 ? filename.slice(dot + 1) : "";
  const tokens: Record<string, string> = {
    "{YYYY}": String(ctx.date.getUTCFullYear()),
    "{MM}": pad(ctx.date.getUTCMonth() + 1),
    "{DD}": pad(ctx.date.getUTCDate()),
    "{filename}": filename,
    "{ext}": ext,
  };
  return template.replace(/\{YYYY\}|\{MM\}|\{DD\}|\{filename\}|\{ext\}/g, (m) => tokens[m] ?? m);
}

export type TemplateValidation = { ok: true } | { ok: false; error: string };

/** Reject templates that are empty, can't vary per file, or escape the root. */
export function validateTemplate(template: string): TemplateValidation {
  if (template.trim().length === 0) return { ok: false, error: "Template is empty" };
  if (!template.includes("{filename}") && !template.includes("{ext}")) {
    return { ok: false, error: "Template must include {filename} or {ext}" };
  }
  if (template.split("/").some((seg) => seg === "..")) {
    return { ok: false, error: "Template must not contain '..'" };
  }
  if (template.startsWith("/")) return { ok: false, error: "Template must not start with '/'" };
  return { ok: true };
}

export const updateSettingsSchema = z.object({
  uploadTemplate: z
    .string()
    .refine((t) => validateTemplate(t).ok, { message: "Invalid upload template" }),
});

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
```

- [ ] **Step 4: Export it** — add to `packages/shared/src/index.ts`:

```ts
export * from "./uploads.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @lumio/shared test uploads`
Expected: PASS (9 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/uploads.ts packages/shared/src/uploads.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): upload template render + validate"
```

---

## Task 6: `AppSettings` model + settings service

**Files:**
- Modify: `packages/db/prisma/schema.prisma`, `packages/db/src/index.ts`
- Create: `packages/db/src/settings.ts`, `packages/db/src/settings.test.ts`
- Migration: new Prisma migration

- [ ] **Step 1: Add the model**

Append to `packages/db/prisma/schema.prisma`:

```prisma
model AppSettings {
  id             Int      @id @default(1)
  uploadTemplate String   @default("{YYYY}/{YYYY}-{MM}-{DD}/{filename}")
  updatedAt      DateTime @updatedAt
}
```

> Note: this default string must stay in sync with `DEFAULT_UPLOAD_TEMPLATE` in `@lumio/shared`.

- [ ] **Step 2: Create the migration and regenerate the client**

Prerequisite: the database is running (`pnpm db:up`).

Run: `pnpm --filter @lumio/db run migrate -- --name add_app_settings`
Expected: creates `packages/db/prisma/migrations/<ts>_add_app_settings/` and applies it; prints "Your database is now in sync".

Run: `pnpm db:generate`
Expected: regenerates the Prisma client so `prisma.appSettings` is typed.

- [ ] **Step 3: Write the failing test**

Create `packages/db/src/settings.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { getSettings, updateSettings } from "./settings.js";

function fakeDb(row: { id: number; uploadTemplate: string }) {
  const calls: unknown[] = [];
  return {
    calls,
    appSettings: {
      upsert: async (args: unknown) => {
        calls.push(args);
        return row;
      },
    },
  };
}

describe("getSettings", () => {
  it("upserts the singleton row (id=1) and returns it", async () => {
    const db = fakeDb({ id: 1, uploadTemplate: "{filename}" });
    const settings = await getSettings(db as never);
    expect(settings.uploadTemplate).toBe("{filename}");
    expect(db.calls[0]).toMatchObject({ where: { id: 1 }, create: { id: 1 }, update: {} });
  });
});

describe("updateSettings", () => {
  it("upserts the singleton row with the new template", async () => {
    const db = fakeDb({ id: 1, uploadTemplate: "{YYYY}/{filename}" });
    const settings = await updateSettings({ uploadTemplate: "{YYYY}/{filename}" }, db as never);
    expect(settings.uploadTemplate).toBe("{YYYY}/{filename}");
    expect(db.calls[0]).toMatchObject({
      where: { id: 1 },
      create: { id: 1, uploadTemplate: "{YYYY}/{filename}" },
      update: { uploadTemplate: "{YYYY}/{filename}" },
    });
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter @lumio/db test settings`
Expected: FAIL — cannot find module `./settings.js`.

- [ ] **Step 5: Write minimal implementation**

Create `packages/db/src/settings.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import type { UpdateSettingsInput } from "@lumio/shared";
import { prisma } from "./client.js";

const SINGLETON_ID = 1;

export interface AppSettingsDTO {
  uploadTemplate: string;
}

/** Get the singleton settings row, creating it with defaults if absent. */
export async function getSettings(
  db: Pick<PrismaClient, "appSettings"> = prisma,
): Promise<AppSettingsDTO> {
  const row = await db.appSettings.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID },
    update: {},
  });
  return { uploadTemplate: row.uploadTemplate };
}

/** Persist new settings on the singleton row. */
export async function updateSettings(
  input: UpdateSettingsInput,
  db: Pick<PrismaClient, "appSettings"> = prisma,
): Promise<AppSettingsDTO> {
  const row = await db.appSettings.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID, uploadTemplate: input.uploadTemplate },
    update: { uploadTemplate: input.uploadTemplate },
  });
  return { uploadTemplate: row.uploadTemplate };
}
```

- [ ] **Step 6: Export it** — add to `packages/db/src/index.ts`:

```ts
export * from "./settings.js";
```

- [ ] **Step 7: Run test to verify it passes**

Run: `pnpm --filter @lumio/db test settings`
Expected: PASS (2 tests).

- [ ] **Step 8: Commit**

```bash
git add packages/db/prisma packages/db/src/settings.ts packages/db/src/settings.test.ts packages/db/src/index.ts
git commit -m "feat(db): AppSettings singleton + getSettings/updateSettings"
```

---

## Task 7: `handleUpload` orchestration (web service)

**Files:**
- Create: `apps/web/src/lib/upload-service.ts`, `apps/web/src/lib/upload-service.test.ts`
- Modify: `apps/web/package.json` (add `@lumio/ingest`), `apps/web/next.config.ts`

- [ ] **Step 1: Add the web dependency + config**

In `apps/web/package.json`, add to `dependencies`:

```json
    "@lumio/ingest": "workspace:*",
    "sharp": "^0.33",
```

Replace `apps/web/next.config.ts` with (adds `@lumio/ingest` to transpile, externalizes the native `sharp` binary so webpack doesn't bundle it):

```ts
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@lumio/db", "@lumio/shared", "@lumio/ingest"],
  serverExternalPackages: ["sharp"],
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
};

export default nextConfig;
```

Run: `pnpm install`
Expected: links `@lumio/ingest` into `apps/web`.

- [ ] **Step 2: Write the failing test**

Create `apps/web/src/lib/upload-service.test.ts`:

```ts
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { DEFAULT_UPLOAD_TEMPLATE } from "@lumio/shared";
import { handleUpload } from "./upload-service.js";

const base = await mkdtemp(path.join(tmpdir(), "lumio-upload-"));
const photosDir = path.join(base, "photos");
const thumbnailsDir = path.join(base, "thumbs");
const displaysDir = path.join(base, "displays");
afterAll(async () => rm(base, { recursive: true, force: true }));

async function jpeg(): Promise<Buffer> {
  return sharp({ create: { width: 16, height: 16, channels: 3, background: "#3366aa" } })
    .jpeg()
    .toBuffer();
}

function fakeDb(existing: { id: string } | null) {
  return {
    photo: {
      findFirst: async () => existing,
      upsert: async () => ({ id: "newid" }),
    },
  };
}

const deps = (existing: { id: string } | null) => ({
  db: fakeDb(existing) as never,
  photosDir,
  thumbnailsDir,
  displaysDir,
  template: DEFAULT_UPLOAD_TEMPLATE,
});

describe("handleUpload", () => {
  it("rejects unsupported extensions", async () => {
    const result = await handleUpload(
      { bytes: Buffer.from("x"), originalFilename: "notes.txt" },
      deps(null),
    );
    expect(result).toEqual({ status: "unsupported" });
  });

  it("reports duplicates without writing", async () => {
    const result = await handleUpload(
      { bytes: await jpeg(), originalFilename: "dup.jpg" },
      deps({ id: "existing" }),
    );
    expect(result).toEqual({ status: "duplicate", id: "existing" });
  });

  it("files a new photo using the template (lastModified date) and writes renditions", async () => {
    const lastModified = Date.UTC(2023, 4, 20); // 2023-05-20
    const result = await handleUpload(
      { bytes: await jpeg(), originalFilename: "IMG_1.jpg", lastModified },
      deps(null),
    );
    expect(result.status).toBe("added");
    if (result.status !== "added") throw new Error("expected added");
    expect(result.path).toBe("2023/2023-05-20/IMG_1.jpg");
    expect(result.id).toBe("newid");
    await expect(access(path.join(photosDir, "2023/2023-05-20/IMG_1.jpg"))).resolves.toBeUndefined();
    await expect(access(path.join(thumbnailsDir, "newid.webp"))).resolves.toBeUndefined();
    await expect(access(path.join(displaysDir, "newid.webp"))).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @lumio/web test upload-service`
Expected: FAIL — cannot find module `./upload-service.js`.

- [ ] **Step 4: Write minimal implementation**

Create `apps/web/src/lib/upload-service.ts`:

```ts
import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@lumio/db";
import {
  extractUploadDate,
  findPhotoByHash,
  ingestPath,
  placeUpload,
  SUPPORTED_EXTENSIONS,
} from "@lumio/ingest";
import { PhotoSource, renderTemplate } from "@lumio/shared";

export interface UploadDeps {
  db: Pick<PrismaClient, "photo">;
  photosDir: string;
  thumbnailsDir: string;
  displaysDir: string;
  template: string;
  now?: Date;
}

export interface UploadInput {
  bytes: Buffer;
  originalFilename: string;
  lastModified?: number;
}

export type UploadResult =
  | { status: "added"; id: string; path: string }
  | { status: "duplicate"; id: string }
  | { status: "unsupported" }
  | { status: "error"; message: string };

export async function handleUpload(input: UploadInput, deps: UploadDeps): Promise<UploadResult> {
  const ext = path.extname(input.originalFilename).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) return { status: "unsupported" };

  const hash = createHash("sha256").update(input.bytes).digest("hex");
  const existing = await findPhotoByHash(hash, deps.db);
  if (existing) return { status: "duplicate", id: existing.id };

  const date = await extractUploadDate(input.bytes, input.lastModified, deps.now ?? new Date());
  const desired = renderTemplate(deps.template, { date, originalFilename: input.originalFilename });

  let relPath: string;
  try {
    relPath = await placeUpload({ bytes: input.bytes, relPath: desired, photosDir: deps.photosDir });
  } catch (err) {
    return { status: "error", message: (err as Error).message };
  }

  try {
    const { id } = await ingestPath(
      relPath,
      {
        db: deps.db,
        photosDir: deps.photosDir,
        thumbnailsDir: deps.thumbnailsDir,
        displaysDir: deps.displaysDir,
      },
      PhotoSource.upload,
    );
    return { status: "added", id, path: relPath };
  } catch (err) {
    // Ingestion failed after the original was written — remove the orphan.
    await rm(path.join(deps.photosDir, relPath), { force: true });
    return { status: "error", message: (err as Error).message };
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @lumio/web test upload-service`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/web/package.json apps/web/next.config.ts apps/web/src/lib/upload-service.ts apps/web/src/lib/upload-service.test.ts
git commit -m "feat(web): handleUpload service (dedup → template → ingest)"
```

---

## Task 8: Upload + settings API routes

**Files:**
- Create: `apps/web/src/app/api/uploads/route.ts`, `apps/web/src/app/api/settings/route.ts`

- [ ] **Step 1: Write the upload route**

Create `apps/web/src/app/api/uploads/route.ts`:

```ts
import path from "node:path";
import { NextResponse } from "next/server";
import { getSettings, prisma } from "@lumio/db";
import { handleUpload } from "@/lib/upload-service";
import { CACHE_DIR, PHOTOS_DIR } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ status: "error", message: "No file provided" }, { status: 400 });
  }

  const lastModifiedRaw = form.get("lastModified");
  const lastModified =
    typeof lastModifiedRaw === "string" && lastModifiedRaw.length > 0
      ? Number(lastModifiedRaw)
      : undefined;

  const bytes = Buffer.from(await file.arrayBuffer());
  const { uploadTemplate } = await getSettings();

  const result = await handleUpload(
    { bytes, originalFilename: file.name, lastModified },
    {
      db: prisma,
      photosDir: PHOTOS_DIR,
      thumbnailsDir: path.join(CACHE_DIR, "thumbnails"),
      displaysDir: path.join(CACHE_DIR, "displays"),
      template: uploadTemplate,
    },
  );

  const code =
    result.status === "added"
      ? 201
      : result.status === "duplicate"
        ? 200
        : result.status === "unsupported"
          ? 415
          : 500;
  return NextResponse.json(result, { status: code });
}
```

- [ ] **Step 2: Write the settings route**

Create `apps/web/src/app/api/settings/route.ts`:

```ts
import { NextResponse } from "next/server";
import { updateSettings } from "@lumio/db";
import { updateSettingsSchema } from "@lumio/shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PUT(request: Request): Promise<NextResponse> {
  const body: unknown = await request.json();
  const parsed = updateSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const settings = await updateSettings(parsed.data);
  return NextResponse.json(settings);
}
```

- [ ] **Step 3: Verify the web build compiles the routes**

Run: `pnpm --filter @lumio/web build`
Expected: PASS — build completes; `/api/uploads` and `/api/settings` appear in the route list. (This is the real check that `@lumio/ingest` + `sharp` resolve under `--webpack`.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/api/uploads/route.ts apps/web/src/app/api/settings/route.ts
git commit -m "feat(web): /api/uploads and /api/settings routes"
```

---

## Task 9: Settings UI — Uploads card

**Files:**
- Create: `apps/web/src/app/settings/upload-template-form.tsx`
- Modify: `apps/web/src/app/settings/page.tsx`

- [ ] **Step 1: Write the client form**

Create `apps/web/src/app/settings/upload-template-form.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  DEFAULT_UPLOAD_TEMPLATE,
  renderTemplate,
  validateTemplate,
} from "@lumio/shared";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const PREVIEW_DATE = new Date("2026-06-18T00:00:00.000Z");

export function UploadTemplateForm({ initial }: { initial: string }) {
  const router = useRouter();
  const [template, setTemplate] = useState(initial);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const validation = validateTemplate(template);
  const preview = validation.ok
    ? renderTemplate(template, { date: PREVIEW_DATE, originalFilename: "IMG_1234.jpg" })
    : null;

  async function save() {
    setState("saving");
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadTemplate: template }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setState("saved");
      router.refresh();
      setTimeout(() => setState("idle"), 1500);
    } catch {
      setState("error");
    }
  }

  return (
    <Card className="space-y-4 p-4">
      <div className="space-y-1">
        <Label htmlFor="uploadTemplate">Upload folder template</Label>
        <Input
          id="uploadTemplate"
          value={template}
          onChange={(e) => setTemplate(e.target.value)}
          className="font-mono"
        />
      </div>

      <p className="text-xs text-muted-foreground">
        Tokens: <code>{"{YYYY}"}</code> <code>{"{MM}"}</code> <code>{"{DD}"}</code>{" "}
        <code>{"{filename}"}</code> <code>{"{ext}"}</code>. Default:{" "}
        <code>{DEFAULT_UPLOAD_TEMPLATE}</code>.
      </p>

      {validation.ok ? (
        <p className="text-sm">
          <span className="text-muted-foreground">Example: </span>
          <span className="font-mono">{preview}</span>
        </p>
      ) : (
        <p className="text-sm text-destructive">{validation.error}</p>
      )}

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={!validation.ok || state === "saving"}>
          {state === "saving" ? "Saving…" : "Save"}
        </Button>
        {state === "saved" && <span className="text-sm text-muted-foreground">Saved</span>}
        {state === "error" && <span className="text-sm text-destructive">Save failed</span>}
      </div>
    </Card>
  );
}
```

- [ ] **Step 2: Wire it into the settings page**

In `apps/web/src/app/settings/page.tsx`, import `getSettings` and the form, read settings, and render an Uploads section. Update the file to:

```tsx
import { getSettings } from "@lumio/db";
import { getStatus } from "@/lib/status-service";
import { Card } from "@/components/ui/card";
import { RescanButton } from "./rescan-button";
import { UploadTemplateForm } from "./upload-template-form";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const status = await getStatus();
  const settings = await getSettings();

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <Card className="space-y-3 p-4">
        <Row label="Photos directory" value={status.photosDir} />
        <Row label="Indexed photos" value={String(status.photoCount)} />
        <Row label="Last indexed" value={status.lastIndexedAt ?? "never"} />
      </Card>

      <div className="space-y-2">
        <h2 className="text-lg font-medium">Uploads</h2>
        <p className="text-sm text-muted-foreground">
          How uploaded photos are organized into folders under your library.
        </p>
        <UploadTemplateForm initial={settings.uploadTemplate} />
      </div>

      <div className="space-y-2">
        <h2 className="text-lg font-medium">Indexing</h2>
        <p className="text-sm text-muted-foreground">
          Trigger a full rescan of the photos directory.
        </p>
        <RescanButton />
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate text-right font-mono">{value}</span>
    </div>
  );
}
```

- [ ] **Step 3: Verify build**

Run: `pnpm --filter @lumio/web build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/settings/upload-template-form.tsx apps/web/src/app/settings/page.tsx
git commit -m "feat(web): upload template settings card"
```

---

## Task 10: Upload page, drop zone, and sidebar entry

**Files:**
- Create: `apps/web/src/app/upload/page.tsx`, `apps/web/src/app/upload/upload-client.tsx`
- Modify: `apps/web/src/components/app-sidebar.tsx`

- [ ] **Step 1: Add the sidebar entry**

In `apps/web/src/components/app-sidebar.tsx`, add `UploadCloud` to the lucide import and a nav item to `PRIMARY`. Change the import line:

```ts
import { Aperture, ArrowLeft, Images, GalleryVerticalEnd, Settings, UploadCloud } from "lucide-react";
```

Change `PRIMARY` to:

```ts
const PRIMARY: NavItem[] = [
  { href: "/photos", label: "Photos", icon: Images, match: ["/photos", "/photo"] },
  { href: "/albums", label: "Albums", icon: GalleryVerticalEnd, match: ["/albums"] },
  { href: "/upload", label: "Upload", icon: UploadCloud, match: ["/upload"] },
];
```

- [ ] **Step 2: Create the upload client component**

Create `apps/web/src/app/upload/upload-client.tsx`:

```tsx
"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { UploadCloud } from "lucide-react";
import { cn } from "@/lib/utils";

type RowStatus = "queued" | "uploading" | "added" | "duplicate" | "unsupported" | "error";

interface Row {
  id: number;
  name: string;
  status: RowStatus;
  message?: string;
}

const CONCURRENCY = 3;

const LABEL: Record<RowStatus, string> = {
  queued: "Queued",
  uploading: "Uploading…",
  added: "Added",
  duplicate: "Already in library",
  unsupported: "Unsupported format",
  error: "Failed",
};

let nextRowId = 1;

export function UploadClient() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [dragging, setDragging] = useState(false);

  const update = useCallback((id: number, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  const uploadOne = useCallback(
    async (file: File, rowId: number) => {
      update(rowId, { status: "uploading" });
      const body = new FormData();
      body.set("file", file);
      body.set("lastModified", String(file.lastModified));
      try {
        const res = await fetch("/api/uploads", { method: "POST", body });
        const data: { status: RowStatus; message?: string } = await res.json();
        update(rowId, { status: data.status, message: data.message });
      } catch (err) {
        update(rowId, { status: "error", message: (err as Error).message });
      }
    },
    [update],
  );

  const addFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      const queued: Array<{ file: File; rowId: number }> = files.map((file) => {
        const rowId = nextRowId++;
        return { file, rowId };
      });
      setRows((prev) => [
        ...queued.map(({ file, rowId }) => ({ id: rowId, name: file.name, status: "queued" as const })),
        ...prev,
      ]);

      // Bounded-concurrency worker pool.
      let cursor = 0;
      async function worker() {
        while (cursor < queued.length) {
          const item = queued[cursor++];
          if (item) await uploadOne(item.file, item.rowId);
        }
      }
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queued.length) }, worker));
      router.refresh();
    },
    [router, uploadOne],
  );

  return (
    <div className="space-y-6">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void addFiles(Array.from(e.dataTransfer.files));
        }}
        className={cn(
          "flex w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed py-16 transition-colors",
          dragging ? "border-foreground bg-muted" : "border-border hover:bg-muted/50",
        )}
      >
        <UploadCloud className="h-10 w-10 text-muted-foreground" strokeWidth={1.6} aria-hidden />
        <span className="text-sm text-muted-foreground">
          Drag photos here, or click to choose files
        </span>
      </button>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*,.jxl,.heic,.heif"
        className="hidden"
        onChange={(e) => {
          void addFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />

      {rows.length > 0 && (
        <ul className="divide-y divide-border rounded-2xl border border-border">
          {rows.map((row) => (
            <li key={row.id} className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm">
              <span className="truncate font-mono">{row.name}</span>
              <span
                className={cn(
                  "shrink-0",
                  row.status === "added" && "text-foreground",
                  (row.status === "error" || row.status === "unsupported") && "text-destructive",
                  (row.status === "queued" ||
                    row.status === "uploading" ||
                    row.status === "duplicate") &&
                    "text-muted-foreground",
                )}
              >
                {row.message && (row.status === "error" || row.status === "unsupported")
                  ? row.message
                  : LABEL[row.status]}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create the page**

Create `apps/web/src/app/upload/page.tsx`:

```tsx
import { UploadClient } from "./upload-client";

export default function UploadPage() {
  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4">
      <h1 className="text-2xl font-semibold">Upload</h1>
      <UploadClient />
    </main>
  );
}
```

- [ ] **Step 4: Verify build**

Run: `pnpm --filter @lumio/web build`
Expected: PASS — `/upload` listed in the route output.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/upload apps/web/src/components/app-sidebar.tsx
git commit -m "feat(web): drag-and-drop upload page + sidebar entry"
```

---

## Task 11: Full-suite check + browser verification

**Files:** none (verification only).

- [ ] **Step 1: Full test suite + typecheck**

Run: `pnpm -r test`
Expected: PASS — new totals roughly: shared 12+9, ingest (moved 13 + new 8), db 9+2, web 12+3.

Run: `pnpm -r typecheck`
Expected: PASS for every package.

- [ ] **Step 2: Manual browser verification**

Prerequisite: `pnpm db:up` (database), then a CLEAN dev server start — a new top-level route was added, so per the project's known gotcha clear `.next` first:

```bash
rm -rf apps/web/.next
pnpm dev
```

Verify in a real browser (use element refs, not pixel clicks) at `http://localhost:3000`:
1. **Sidebar** shows the new **Upload** item; clicking it navigates to `/upload`.
2. **Settings** → Uploads card: the template input shows the saved value, the live example updates as you type, an invalid template (e.g. `{YYYY}`) shows the validation error and disables Save, and a valid Save persists across a refresh.
3. **Upload page**: drag-drop (and click-to-pick) a JPEG → row goes `Uploading… → Added`; the file lands under `/photos/2026/2026-06-18/<name>` (or per the configured template); it appears in the **Photos** grid after the refresh.
4. **Dedup**: drop the same file again → row shows **Already in library**; no second copy under `/photos`.
5. **Unsupported**: drop a `.txt` → row shows **Unsupported format**.

- [ ] **Step 3: Final commit (if any verification fixups were needed)**

```bash
git add -A
git commit -m "fix(web): upload verification fixups"
```

(Skip if nothing changed.)

---

## Self-Review Notes (for the implementer)
- **Type consistency:** `ingestPath(relPath, deps, source?)` returns `{ id }`; `IngestDeps` has `{ db, photosDir, thumbnailsDir, displaysDir }`; `placeUpload` returns the final POSIX relPath string; `handleUpload` returns the `UploadResult` union; the route maps `added→201, duplicate→200, unsupported→415, error→500`.
- **Spec coverage:** template (Task 5) · dedup (Tasks 2, 7) · synchronous ingest + shared pipeline (Tasks 1, 7) · date fallback (Task 4) · settings persistence (Task 6) · upload page + drop zone (Task 10) · settings UI (Task 9) · sidebar (Task 10) · error handling incl. orphan cleanup + traversal (Tasks 3, 7) · all test buckets (every task).
- **Known limitation (matches spec non-goals):** two byte-identical files uploaded in the same batch can both pass the hash check before either is stored, producing two rows; acceptable for MVP.
