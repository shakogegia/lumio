# Delete Image + Trash Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users delete photos (single from the detail view, bulk from grid selection) into a recoverable Trash with its own page for Restore / Delete permanently / Empty trash.

**Architecture:** Deleted photos move to a new `TrashedPhoto` table + a `TRASH_DIR` outside the watched `PHOTOS_DIR`. A `trash-service` performs all DB+file moves itself (it does not rely on the filesystem watcher); ordering is chosen so the watcher's resulting `unlink`/`add` events are harmless no-ops/in-place upserts. New API routes wrap the service in `withAuth`. The UI reuses the existing grid-selection infra and adds a Trash page.

**Tech Stack:** Next.js (App Router, RSC + client components), Prisma/Postgres, Zod (`@lumio/shared`), Vitest, Tailwind + shadcn/ui.

---

## File Structure

**Create:**
- `apps/web/src/lib/trash-service.ts` — `trashPhotos`, `listTrash`, `restorePhotos`, `purgeTrash` + file-move helpers
- `apps/web/src/lib/trash-service.test.ts` — service unit tests
- `apps/web/src/app/api/photos/trash/route.ts` — `POST` move-to-trash
- `apps/web/src/app/api/trash/route.ts` — `GET` paginated trash list
- `apps/web/src/app/api/trash/restore/route.ts` — `POST` restore
- `apps/web/src/app/api/trash/purge/route.ts` — `POST` permanent delete (by ids)
- `apps/web/src/app/api/trash/empty/route.ts` — `POST` empty all
- `apps/web/src/app/(app)/trash/page.tsx` — server page
- `apps/web/src/app/(app)/trash/trash-view.tsx` — client Trash management UI
- `apps/web/src/app/(app)/photo/[id]/delete-photo-button.tsx` — single-delete button

**Modify:**
- `packages/db/prisma/schema.prisma` — add `TrashedPhoto` model
- `packages/db/src/index.ts` — export `TrashedPhoto` type
- `packages/db/src/mappers.ts` — add `toTrashedPhotoDTO`
- `packages/shared/src/api.ts` — add `photoIdsSchema`
- `apps/web/src/lib/paths.ts` — add `TRASH_DIR` + trash path helpers
- `apps/web/src/app/api/thumbnails/[id]/route.ts` — fall back to trash thumbnails
- `apps/web/src/app/(app)/photo/[id]/photo-detail.tsx` — render `DeletePhotoButton`
- `apps/web/src/app/(app)/photos/library-view.tsx` — bulk Delete action
- `apps/web/src/app/(app)/albums/[id]/album-view.tsx` — bulk Delete action
- `apps/web/src/components/sidebar-more.tsx` — Trash menu link

---

## Task 1: Add the `TrashedPhoto` schema + migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Add the model**

In `packages/db/prisma/schema.prisma`, after the `AlbumPhoto` model (around line 51), add:

```prisma
model TrashedPhoto {
  id           String      @id
  originalPath String
  source      PhotoSource
  takenAt      DateTime?
  sortDate     DateTime
  width        Int
  height       Int
  hash         String?
  exif         Json
  albumIds     String[]
  deletedAt    DateTime    @default(now())

  @@index([deletedAt, id])
}
```

- [ ] **Step 2: Export the generated type**

In `packages/db/src/index.ts`, add `TrashedPhoto` to the type re-export line:

```ts
export type { Photo, Album, AlbumPhoto, TrashedPhoto, Prisma, PrismaClient } from "@prisma/client";
```

- [ ] **Step 3: Generate the migration + client**

Run:

```bash
cd packages/db && pnpm migrate -- --name add_trashed_photo && pnpm generate
```

(`pnpm migrate` runs `dotenv -e ../../.env -- prisma migrate dev`; the `-- --name …` is forwarded to it. `pnpm generate` runs `prisma generate`.)

Expected: a new folder `packages/db/prisma/migrations/<timestamp>_add_trashed_photo/` is created and the Prisma client regenerates without error.

> Note: the DB runs on port **5433** (see `.env`). If `migrate dev` can't connect, confirm the DB container is up before retrying.

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations packages/db/src/index.ts
git commit -m "feat(db): add TrashedPhoto model + migration"
```

---

## Task 2: Add the `toTrashedPhotoDTO` mapper

**Files:**
- Modify: `packages/db/src/mappers.ts`
- Test: `packages/db/src/mappers.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/db/src/mappers.test.ts`:

```ts
import { toTrashedPhotoDTO } from "./mappers.js";

describe("toTrashedPhotoDTO", () => {
  it("maps a trashed row to a PhotoDTO using originalPath + deletedAt", () => {
    const dto = toTrashedPhotoDTO({
      id: "t1",
      originalPath: "2026/06-19/x.jpg",
      source: "filesystem",
      takenAt: new Date("2024-01-01T00:00:00.000Z"),
      sortDate: new Date("2024-01-01T00:00:00.000Z"),
      width: 4,
      height: 3,
      hash: null,
      exif: {},
      albumIds: ["a1"],
      deletedAt: new Date("2026-06-19T00:00:00.000Z"),
    } as never);
    expect(dto.id).toBe("t1");
    expect(dto.path).toBe("2026/06-19/x.jpg");
    expect(dto.width).toBe(4);
    expect(dto.createdAt).toBe("2026-06-19T00:00:00.000Z");
    expect(dto.updatedAt).toBe("2026-06-19T00:00:00.000Z");
  });
});
```

If `mappers.test.ts` has no `describe`/`expect`/`it` import yet, add at the top: `import { describe, expect, it } from "vitest";` (check first — don't duplicate an existing import).

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd packages/db && pnpm exec vitest run src/mappers.test.ts`
Expected: FAIL — `toTrashedPhotoDTO is not a function` (or import error).

- [ ] **Step 3: Implement the mapper**

In `packages/db/src/mappers.ts`, add `TrashedPhoto` to the type import from `@prisma/client`:

```ts
import type { Album, Photo, TrashedPhoto } from "@prisma/client";
```

Then add the function after `toPhotoDTO`:

```ts
export function toTrashedPhotoDTO(row: TrashedPhoto): PhotoDTO {
  return {
    id: row.id,
    path: row.originalPath,
    source: row.source as PhotoSource,
    takenAt: row.takenAt ? row.takenAt.toISOString() : null,
    width: row.width,
    height: row.height,
    hash: row.hash,
    exif: (row.exif ?? {}) as ExifData,
    createdAt: row.deletedAt.toISOString(),
    updatedAt: row.deletedAt.toISOString(),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd packages/db && pnpm exec vitest run src/mappers.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/mappers.ts packages/db/src/mappers.test.ts
git commit -m "feat(db): toTrashedPhotoDTO mapper"
```

---

## Task 3: Add the `photoIdsSchema` request schema

**Files:**
- Modify: `packages/shared/src/api.ts`

- [ ] **Step 1: Add the schema**

In `packages/shared/src/api.ts`, after the `PhotosPage` interface (around line 16), add:

```ts
/** Request body for bulk photo/trash operations. */
export const photoIdsSchema = z.object({
  ids: z.array(z.string().min(1)).min(1),
});

export type PhotoIdsInput = z.infer<typeof photoIdsSchema>;
```

- [ ] **Step 2: Typecheck the shared package**

Run: `cd packages/shared && pnpm typecheck`
Expected: no type errors (the new export is picked up by `index.ts`'s `export * from "./api.js"`).

- [ ] **Step 3: Commit**

```bash
git add packages/shared/src/api.ts
git commit -m "feat(shared): photoIdsSchema for bulk photo ops"
```

---

## Task 4: Add `TRASH_DIR` + trash path helpers

**Files:**
- Modify: `apps/web/src/lib/paths.ts`

- [ ] **Step 1: Add the constants and helpers**

In `apps/web/src/lib/paths.ts`, after the `CACHE_DIR` line (line 7), add:

```ts
export const TRASH_DIR = path.resolve(ROOT, process.env.TRASH_DIR ?? "./trash");
```

Then after `displayPath` (line 15), add:

```ts
export function trashOriginalPath(id: string, ext: string): string {
  return path.join(TRASH_DIR, "originals", `${id}${ext}`);
}

export function trashThumbnailPath(id: string): string {
  return path.join(TRASH_DIR, "thumbnails", `${id}.webp`);
}

export function trashDisplayPath(id: string): string {
  return path.join(TRASH_DIR, "displays", `${id}.webp`);
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/web && pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/paths.ts
git commit -m "feat(web): TRASH_DIR + trash path helpers"
```

---

## Task 5: `trashPhotos` + file-move helper (move to trash)

**Files:**
- Create: `apps/web/src/lib/trash-service.ts`
- Test: `apps/web/src/lib/trash-service.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/trash-service.test.ts`:

```ts
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { trashPhotos } from "./trash-service.js";

async function dirs() {
  const photosDir = await mkdtemp(path.join(tmpdir(), "lumio-photos-"));
  const cacheDir = await mkdtemp(path.join(tmpdir(), "lumio-cache-"));
  const trashDir = await mkdtemp(path.join(tmpdir(), "lumio-trash-"));
  await mkdir(path.join(cacheDir, "thumbnails"), { recursive: true });
  await mkdir(path.join(cacheDir, "displays"), { recursive: true });
  return { photosDir, cacheDir, trashDir };
}

describe("trashPhotos", () => {
  it("snapshots, moves files into the trash, and deletes the photo row", async () => {
    const { photosDir, cacheDir, trashDir } = await dirs();
    await writeFile(path.join(photosDir, "a.jpg"), "orig");
    await writeFile(path.join(cacheDir, "thumbnails", "a.webp"), "thumb");
    await writeFile(path.join(cacheDir, "displays", "a.webp"), "display");

    const created: unknown[] = [];
    const db = {
      photo: {
        findUnique: async () => ({
          id: "a",
          path: "a.jpg",
          source: "filesystem",
          takenAt: null,
          sortDate: new Date("2024-01-01T00:00:00.000Z"),
          width: 10,
          height: 10,
          hash: null,
          exif: {},
          albums: [{ albumId: "alb1" }],
        }),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      trashedPhoto: {
        create: async (args: unknown) => {
          created.push(args);
          return {};
        },
      },
    };

    const result = await trashPhotos(["a"], {
      db: db as never,
      photosDir,
      cacheDir,
      trashDir,
    });

    expect(result).toEqual({ trashed: 1 });
    // snapshot captured the album membership
    expect(created).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({ id: "a", originalPath: "a.jpg", albumIds: ["alb1"] }),
      }),
    ]);
    // files moved out of their live locations into the trash
    expect(existsSync(path.join(photosDir, "a.jpg"))).toBe(false);
    expect(existsSync(path.join(trashDir, "originals", "a.jpg"))).toBe(true);
    expect(existsSync(path.join(trashDir, "thumbnails", "a.webp"))).toBe(true);
    expect(existsSync(path.join(trashDir, "displays", "a.webp"))).toBe(true);
    expect(db.photo.deleteMany).toHaveBeenCalledWith({ where: { id: "a" } });
  });

  it("skips ids that no longer exist", async () => {
    const { photosDir, cacheDir, trashDir } = await dirs();
    const db = {
      photo: { findUnique: async () => null, deleteMany: vi.fn() },
      trashedPhoto: { create: vi.fn() },
    };
    const result = await trashPhotos(["gone"], {
      db: db as never,
      photosDir,
      cacheDir,
      trashDir,
    });
    expect(result).toEqual({ trashed: 0 });
    expect(db.trashedPhoto.create).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && pnpm exec vitest run src/lib/trash-service.test.ts`
Expected: FAIL — cannot find module `./trash-service.js` / `trashPhotos` undefined.

- [ ] **Step 3: Implement `trashPhotos` + helpers**

Create `apps/web/src/lib/trash-service.ts`:

```ts
import { copyFile, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { type PrismaClient, prisma } from "@lumio/db";
import { CACHE_DIR, PHOTOS_DIR, TRASH_DIR } from "@/lib/paths";

type Db = Pick<PrismaClient, "photo" | "trashedPhoto" | "album">;

export interface TrashDeps {
  db: Db;
  photosDir: string;
  cacheDir: string;
  trashDir: string;
}

const defaultDeps: TrashDeps = {
  db: prisma,
  photosDir: PHOTOS_DIR,
  cacheDir: CACHE_DIR,
  trashDir: TRASH_DIR,
};

/** Move a file, tolerating a missing source and cross-device renames. */
async function moveFile(from: string, to: string): Promise<void> {
  await mkdir(path.dirname(to), { recursive: true });
  try {
    await rename(from, to);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return; // best-effort: nothing to move
    if (code === "EXDEV") {
      await copyFile(from, to);
      await rm(from, { force: true });
      return;
    }
    throw err;
  }
}

export async function trashPhotos(
  ids: string[],
  deps: TrashDeps = defaultDeps,
): Promise<{ trashed: number }> {
  let trashed = 0;
  for (const id of ids) {
    const photo = await deps.db.photo.findUnique({
      where: { id },
      include: { albums: { select: { albumId: true } } },
    });
    if (!photo) continue;

    // 1. Snapshot BEFORE any row deletion so no race can lose the metadata.
    await deps.db.trashedPhoto.create({
      data: {
        id: photo.id,
        originalPath: photo.path,
        source: photo.source,
        takenAt: photo.takenAt,
        sortDate: photo.sortDate,
        width: photo.width,
        height: photo.height,
        hash: photo.hash,
        exif: photo.exif as object,
        albumIds: photo.albums.map((a) => a.albumId),
      },
    });

    // 2. Move renditions + original into the trash.
    const ext = path.extname(photo.path);
    await moveFile(
      path.join(deps.cacheDir, "thumbnails", `${id}.webp`),
      path.join(deps.trashDir, "thumbnails", `${id}.webp`),
    );
    await moveFile(
      path.join(deps.cacheDir, "displays", `${id}.webp`),
      path.join(deps.trashDir, "displays", `${id}.webp`),
    );
    await moveFile(
      path.join(deps.photosDir, photo.path),
      path.join(deps.trashDir, "originals", `${id}${ext}`),
    );

    // 3. Delete the Photo row. deleteMany is tolerant of "already gone" — the
    //    watcher's unlink (fired by step 2) may delete it first; same end state.
    await deps.db.photo.deleteMany({ where: { id } });
    trashed++;
  }
  return { trashed };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/web && pnpm exec vitest run src/lib/trash-service.test.ts`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/trash-service.ts apps/web/src/lib/trash-service.test.ts
git commit -m "feat(web): trashPhotos service (move to trash)"
```

---

## Task 6: `listTrash` (paginated trash listing)

**Files:**
- Modify: `apps/web/src/lib/trash-service.ts`
- Test: `apps/web/src/lib/trash-service.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `apps/web/src/lib/trash-service.test.ts` (add `listTrash` to the import at the top: `import { listTrash, trashPhotos } from "./trash-service.js";`):

```ts
function trashRow(id: string) {
  return {
    id,
    originalPath: `${id}.jpg`,
    source: "filesystem" as const,
    takenAt: null,
    sortDate: new Date("2024-01-01T00:00:00.000Z"),
    width: 10,
    height: 10,
    hash: null,
    exif: {},
    albumIds: [],
    deletedAt: new Date("2026-06-19T00:00:00.000Z"),
  };
}

describe("listTrash", () => {
  it("returns a page with nextCursor = last id when full", async () => {
    const rows = [trashRow("a"), trashRow("b")];
    const db = {
      trashedPhoto: {
        findMany: async (args: { take: number; orderBy?: unknown }) => {
          expect(args.orderBy).toEqual([{ deletedAt: "desc" }, { id: "desc" }]);
          return rows.slice(0, args.take);
        },
      },
    };
    const page = await listTrash({ limit: 2 }, db as never);
    expect(page.items.map((p) => p.id)).toEqual(["a", "b"]);
    expect(page.nextCursor).toBe("b");
  });

  it("returns nextCursor = null when fewer than limit", async () => {
    const db = {
      trashedPhoto: { findMany: async () => [trashRow("a")] },
    };
    const page = await listTrash({ limit: 2 }, db as never);
    expect(page.nextCursor).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && pnpm exec vitest run src/lib/trash-service.test.ts -t listTrash`
Expected: FAIL — `listTrash` is not exported.

- [ ] **Step 3: Implement `listTrash`**

In `apps/web/src/lib/trash-service.ts`, update imports and add the function. Change the `@lumio/db` import line to also bring in the mapper, and add the shared type import:

```ts
import { type PrismaClient, prisma, toTrashedPhotoDTO } from "@lumio/db";
import type { PhotosPage, PhotosQuery } from "@lumio/shared";
```

Then add (a read-only `Db` is fine, but reuse the existing `Db` type):

```ts
export async function listTrash(
  params: PhotosQuery,
  db: Db = prisma,
): Promise<PhotosPage> {
  const { limit, cursor } = params;
  const rows = await db.trashedPhoto.findMany({
    take: limit,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    orderBy: [{ deletedAt: "desc" }, { id: "desc" }],
  });
  const nextCursor =
    rows.length === limit ? (rows[rows.length - 1]?.id ?? null) : null;
  return { items: rows.map(toTrashedPhotoDTO), nextCursor };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/web && pnpm exec vitest run src/lib/trash-service.test.ts -t listTrash`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/trash-service.ts apps/web/src/lib/trash-service.test.ts
git commit -m "feat(web): listTrash paginated listing"
```

---

## Task 7: `restorePhotos` (restore from trash) + free-path helper

**Files:**
- Modify: `apps/web/src/lib/trash-service.ts`
- Test: `apps/web/src/lib/trash-service.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `apps/web/src/lib/trash-service.test.ts` (add `restorePhotos` to the import). Reuses `dirs()` and `trashRow()` from earlier tasks:

```ts
describe("restorePhotos", () => {
  it("recreates the photo (same id + surviving albums) and moves files back", async () => {
    const { photosDir, cacheDir, trashDir } = await dirs();
    await mkdir(path.join(trashDir, "originals"), { recursive: true });
    await mkdir(path.join(trashDir, "thumbnails"), { recursive: true });
    await mkdir(path.join(trashDir, "displays"), { recursive: true });
    await writeFile(path.join(trashDir, "originals", "a.jpg"), "orig");
    await writeFile(path.join(trashDir, "thumbnails", "a.webp"), "thumb");
    await writeFile(path.join(trashDir, "displays", "a.webp"), "display");

    let createArgs: { data: { id: string; path: string; albums: { create: { albumId: string }[] } } } | null = null;
    const db = {
      trashedPhoto: {
        findUnique: async () => ({ ...trashRow("a"), albumIds: ["keep", "gone"] }),
        delete: vi.fn().mockResolvedValue({}),
      },
      album: {
        findMany: async () => [{ id: "keep" }], // "gone" no longer exists
      },
      photo: {
        create: async (args: never) => {
          createArgs = args;
          return {};
        },
      },
    };

    const result = await restorePhotos(["a"], {
      db: db as never,
      photosDir,
      cacheDir,
      trashDir,
    });

    expect(result).toEqual({ restored: 1 });
    expect(createArgs!.data.id).toBe("a");
    expect(createArgs!.data.path).toBe("a.jpg");
    expect(createArgs!.data.albums.create).toEqual([{ albumId: "keep" }]);
    expect(existsSync(path.join(photosDir, "a.jpg"))).toBe(true);
    expect(existsSync(path.join(cacheDir, "thumbnails", "a.webp"))).toBe(true);
    expect(db.trashedPhoto.delete).toHaveBeenCalledWith({ where: { id: "a" } });
  });

  it("restores to a suffixed path when the original path is occupied", async () => {
    const { photosDir, cacheDir, trashDir } = await dirs();
    await writeFile(path.join(photosDir, "a.jpg"), "a different file"); // occupied
    await mkdir(path.join(trashDir, "originals"), { recursive: true });
    await writeFile(path.join(trashDir, "originals", "a.jpg"), "orig");

    let restoredPath = "";
    const db = {
      trashedPhoto: {
        findUnique: async () => trashRow("a"),
        delete: async () => ({}),
      },
      album: { findMany: async () => [] },
      photo: {
        create: async (args: { data: { path: string } }) => {
          restoredPath = args.data.path;
          return {};
        },
      },
    };

    await restorePhotos(["a"], { db: db as never, photosDir, cacheDir, trashDir });
    expect(restoredPath).toBe("a (restored).jpg");
    expect(existsSync(path.join(photosDir, "a (restored).jpg"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && pnpm exec vitest run src/lib/trash-service.test.ts -t restorePhotos`
Expected: FAIL — `restorePhotos` is not exported.

- [ ] **Step 3: Implement `restorePhotos` + `freePath` + `existingAlbumIds`**

In `apps/web/src/lib/trash-service.ts`, add `existsSync` to the node imports:

```ts
import { existsSync } from "node:fs";
```

Add the helpers and the function:

```ts
/** A path under photosDir that's free; appends " (restored)" suffixes if taken. */
function freePath(photosDir: string, relPath: string): string {
  if (!existsSync(path.join(photosDir, relPath))) return relPath;
  const dir = path.dirname(relPath);
  const ext = path.extname(relPath);
  const base = path.basename(relPath, ext);
  for (let i = 1; ; i++) {
    const suffix = i === 1 ? " (restored)" : ` (restored ${i})`;
    const candidate = path.join(dir, `${base}${suffix}${ext}`);
    if (!existsSync(path.join(photosDir, candidate))) return candidate;
  }
}

async function existingAlbumIds(db: Db, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db.album.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

export async function restorePhotos(
  ids: string[],
  deps: TrashDeps = defaultDeps,
): Promise<{ restored: number }> {
  let restored = 0;
  for (const id of ids) {
    const t = await deps.db.trashedPhoto.findUnique({ where: { id } });
    if (!t) continue;

    const destRel = freePath(deps.photosDir, t.originalPath);
    const albumIds = await existingAlbumIds(deps.db, t.albumIds);

    // 1. Recreate the row (same id) BEFORE the file lands, so the watcher's
    //    `add` upserts in place (keeps id + album links) instead of recreating.
    await deps.db.photo.create({
      data: {
        id: t.id,
        path: destRel,
        source: t.source,
        takenAt: t.takenAt,
        sortDate: t.sortDate,
        width: t.width,
        height: t.height,
        hash: t.hash,
        exif: t.exif as object,
        albums: { create: albumIds.map((albumId) => ({ albumId })) },
      },
    });

    // 2. Move renditions + original back.
    const ext = path.extname(t.originalPath);
    await moveFile(
      path.join(deps.trashDir, "thumbnails", `${id}.webp`),
      path.join(deps.cacheDir, "thumbnails", `${id}.webp`),
    );
    await moveFile(
      path.join(deps.trashDir, "displays", `${id}.webp`),
      path.join(deps.cacheDir, "displays", `${id}.webp`),
    );
    await moveFile(
      path.join(deps.trashDir, "originals", `${id}${ext}`),
      path.join(deps.photosDir, destRel),
    );

    // 3. Drop the trash record.
    await deps.db.trashedPhoto.delete({ where: { id } });
    restored++;
  }
  return { restored };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/web && pnpm exec vitest run src/lib/trash-service.test.ts -t restorePhotos`
Expected: PASS (both cases).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/trash-service.ts apps/web/src/lib/trash-service.test.ts
git commit -m "feat(web): restorePhotos with album + path-collision handling"
```

---

## Task 8: `purgeTrash` (permanent delete + empty)

**Files:**
- Modify: `apps/web/src/lib/trash-service.ts`
- Test: `apps/web/src/lib/trash-service.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `apps/web/src/lib/trash-service.test.ts` (add `purgeTrash` to the import):

```ts
describe("purgeTrash", () => {
  it("removes trash files and rows for the given ids", async () => {
    const { photosDir, cacheDir, trashDir } = await dirs();
    await mkdir(path.join(trashDir, "originals"), { recursive: true });
    await mkdir(path.join(trashDir, "thumbnails"), { recursive: true });
    await writeFile(path.join(trashDir, "originals", "a.jpg"), "orig");
    await writeFile(path.join(trashDir, "thumbnails", "a.webp"), "thumb");

    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const db = {
      trashedPhoto: {
        findMany: async () => [{ id: "a", originalPath: "a.jpg" }],
        deleteMany,
      },
    };

    const result = await purgeTrash(["a"], {
      db: db as never,
      photosDir,
      cacheDir,
      trashDir,
    });

    expect(result).toEqual({ deleted: 1 });
    expect(existsSync(path.join(trashDir, "originals", "a.jpg"))).toBe(false);
    expect(existsSync(path.join(trashDir, "thumbnails", "a.webp"))).toBe(false);
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["a"] } } });
  });

  it("empties everything when ids is undefined", async () => {
    const { photosDir, cacheDir, trashDir } = await dirs();
    const deleteMany = vi.fn().mockResolvedValue({ count: 3 });
    const db = {
      trashedPhoto: {
        findMany: async () => [],
        deleteMany,
      },
    };
    const result = await purgeTrash(undefined, {
      db: db as never,
      photosDir,
      cacheDir,
      trashDir,
    });
    expect(result).toEqual({ deleted: 3 });
    expect(deleteMany).toHaveBeenCalledWith({ where: {} });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/web && pnpm exec vitest run src/lib/trash-service.test.ts -t purgeTrash`
Expected: FAIL — `purgeTrash` is not exported.

- [ ] **Step 3: Implement `purgeTrash`**

In `apps/web/src/lib/trash-service.ts`, add:

```ts
export async function purgeTrash(
  ids: string[] | undefined,
  deps: TrashDeps = defaultDeps,
): Promise<{ deleted: number }> {
  const where = ids ? { id: { in: ids } } : {};
  const rows = await deps.db.trashedPhoto.findMany({
    where,
    select: { id: true, originalPath: true },
  });
  await Promise.all(
    rows.flatMap((r) => {
      const ext = path.extname(r.originalPath);
      return [
        rm(path.join(deps.trashDir, "originals", `${r.id}${ext}`), { force: true }),
        rm(path.join(deps.trashDir, "thumbnails", `${r.id}.webp`), { force: true }),
        rm(path.join(deps.trashDir, "displays", `${r.id}.webp`), { force: true }),
      ];
    }),
  );
  const { count } = await deps.db.trashedPhoto.deleteMany({ where });
  return { deleted: count };
}
```

- [ ] **Step 4: Run all trash-service tests to verify they pass**

Run: `cd apps/web && pnpm exec vitest run src/lib/trash-service.test.ts`
Expected: PASS (all describe blocks).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/trash-service.ts apps/web/src/lib/trash-service.test.ts
git commit -m "feat(web): purgeTrash (permanent delete + empty)"
```

---

## Task 9: API route — `POST /api/photos/trash`

**Files:**
- Create: `apps/web/src/app/api/photos/trash/route.ts`

- [ ] **Step 1: Implement the route**

Create `apps/web/src/app/api/photos/trash/route.ts`:

```ts
import { NextResponse } from "next/server";
import { photoIdsSchema } from "@lumio/shared";
import { trashPhotos } from "@/lib/trash-service";
import { withAuth } from "@/lib/with-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withAuth(async (request) => {
  const body: unknown = await request.json();
  const parsed = photoIdsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const result = await trashPhotos(parsed.data.ids);
  return NextResponse.json(result);
});
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/web && pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/api/photos/trash/route.ts
git commit -m "feat(web): POST /api/photos/trash"
```

---

## Task 10: API routes — trash list / restore / purge / empty

**Files:**
- Create: `apps/web/src/app/api/trash/route.ts`
- Create: `apps/web/src/app/api/trash/restore/route.ts`
- Create: `apps/web/src/app/api/trash/purge/route.ts`
- Create: `apps/web/src/app/api/trash/empty/route.ts`

- [ ] **Step 1: Implement the list route**

Create `apps/web/src/app/api/trash/route.ts`:

```ts
import { NextResponse } from "next/server";
import { photosQuerySchema } from "@lumio/shared";
import { listTrash } from "@/lib/trash-service";
import { withAuth } from "@/lib/with-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (request) => {
  const { searchParams } = new URL(request.url);
  const parsed = photosQuerySchema.safeParse(Object.fromEntries(searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const page = await listTrash(parsed.data);
  return NextResponse.json(page);
});
```

- [ ] **Step 2: Implement the restore route**

Create `apps/web/src/app/api/trash/restore/route.ts`:

```ts
import { NextResponse } from "next/server";
import { photoIdsSchema } from "@lumio/shared";
import { restorePhotos } from "@/lib/trash-service";
import { withAuth } from "@/lib/with-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withAuth(async (request) => {
  const body: unknown = await request.json();
  const parsed = photoIdsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const result = await restorePhotos(parsed.data.ids);
  return NextResponse.json(result);
});
```

- [ ] **Step 3: Implement the purge route**

Create `apps/web/src/app/api/trash/purge/route.ts`:

```ts
import { NextResponse } from "next/server";
import { photoIdsSchema } from "@lumio/shared";
import { purgeTrash } from "@/lib/trash-service";
import { withAuth } from "@/lib/with-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withAuth(async (request) => {
  const body: unknown = await request.json();
  const parsed = photoIdsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const result = await purgeTrash(parsed.data.ids);
  return NextResponse.json(result);
});
```

- [ ] **Step 4: Implement the empty route**

Create `apps/web/src/app/api/trash/empty/route.ts`:

```ts
import { NextResponse } from "next/server";
import { purgeTrash } from "@/lib/trash-service";
import { withAuth } from "@/lib/with-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withAuth(async () => {
  const result = await purgeTrash(undefined);
  return NextResponse.json(result);
});
```

- [ ] **Step 5: Typecheck**

Run: `cd apps/web && pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/api/trash
git commit -m "feat(web): trash list/restore/purge/empty API routes"
```

---

## Task 11: Thumbnail route falls back to trash thumbnails

**Files:**
- Modify: `apps/web/src/app/api/thumbnails/[id]/route.ts`

- [ ] **Step 1: Update the route**

Replace the body of `apps/web/src/app/api/thumbnails/[id]/route.ts` with:

```ts
import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { thumbnailPath, trashThumbnailPath } from "@/lib/paths";
import { withAuth } from "@/lib/with-auth";

export const runtime = "nodejs";

function webp(file: Buffer): NextResponse {
  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}

export const GET = withAuth(
  async (_request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    try {
      return webp(await readFile(thumbnailPath(id)));
    } catch {
      // Trashed photos keep their thumbnail under TRASH_DIR so the Trash grid
      // can render via the same /api/thumbnails/<id> URL.
      try {
        return webp(await readFile(trashThumbnailPath(id)));
      } catch {
        return NextResponse.json({ error: "Thumbnail not found" }, { status: 404 });
      }
    }
  },
);
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/web && pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/api/thumbnails/[id]/route.ts
git commit -m "feat(web): thumbnail route falls back to trash thumbnails"
```

---

## Task 12: Single-photo delete button (detail view)

**Files:**
- Create: `apps/web/src/app/(app)/photo/[id]/delete-photo-button.tsx`
- Modify: `apps/web/src/app/(app)/photo/[id]/photo-detail.tsx`

- [ ] **Step 1: Create the button**

Create `apps/web/src/app/(app)/photo/[id]/delete-photo-button.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function DeletePhotoButton({ photoId }: { photoId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleDelete() {
    if (!confirm("Move this photo to Trash?")) return;
    setPending(true);
    try {
      const res = await fetch("/api/photos/trash", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: [photoId] }),
      });
      if (res.ok) {
        router.back();
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <Button
      variant="destructive"
      size="sm"
      className="w-full"
      disabled={pending}
      onClick={() => void handleDelete()}
    >
      <Trash2 aria-hidden />
      {pending ? "Deleting…" : "Move to Trash"}
    </Button>
  );
}
```

- [ ] **Step 2: Render it in the detail sidebar**

In `apps/web/src/app/(app)/photo/[id]/photo-detail.tsx`, add the import near the other local imports (after the `FilmStrip` import on line 16):

```tsx
import { DeletePhotoButton } from "./delete-photo-button";
```

Then, inside `TabsContent value="info"`, after the `{regularAlbums.length > 0 && (...)}` block and before the closing `</TabsContent>` (around line 123), add:

```tsx
            <Separator />
            <DeletePhotoButton photoId={photo.id} />
```

(`Separator` is already imported at line 11.)

- [ ] **Step 3: Typecheck**

Run: `cd apps/web && pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Manual verification**

Run the app (`pnpm dev` per the repo's dev workflow), open a photo's detail view, click **Move to Trash**, confirm the dialog. Expected: navigates back to the grid and the photo is gone. (Full browser verification happens in Task 16.)

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(app)/photo/[id]/delete-photo-button.tsx" "apps/web/src/app/(app)/photo/[id]/photo-detail.tsx"
git commit -m "feat(web): move-to-trash button on photo detail"
```

---

## Task 13: Bulk delete in the library view

**Files:**
- Modify: `apps/web/src/app/(app)/photos/library-view.tsx`

- [ ] **Step 1: Add the delete handler + reload key + toolbar action**

Replace the contents of `apps/web/src/app/(app)/photos/library-view.tsx` with:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useGridSelection } from "@/lib/use-grid-selection";
import { useGridView } from "@/lib/use-grid-view";
import { GridViewMenu } from "@/components/grid-view-menu";
import { PhotoGrid } from "@/components/photo-grid/photo-grid";
import { SelectionToolbar } from "./selection-toolbar";
import { AddToAlbumDialog } from "./add-to-album-dialog";
import { HeaderBar } from "@/components/header-bar";

export function LibraryView() {
  const router = useRouter();
  const sel = useGridSelection();
  const { mode, setMode } = useGridView();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function handleCancel() {
    setDeleteError(null);
    sel.cancel();
  }

  async function handleDelete() {
    const ids = [...sel.selected];
    if (ids.length === 0 || deleting) return;
    const label = `${ids.length} ${ids.length === 1 ? "photo" : "photos"}`;
    if (!confirm(`Move ${label} to Trash?`)) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const res = await fetch("/api/photos/trash", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (res.ok) {
        sel.cancel();
        setReloadKey((k) => k + 1);
        router.refresh();
      } else {
        setDeleteError("Failed to move photos to Trash.");
      }
    } catch {
      setDeleteError("Failed to move photos to Trash.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      {sel.selectMode ? (
        <SelectionToolbar
          title="Select photos"
          count={sel.count}
          onCancel={handleCancel}
          actions={
            <>
              <Button size="sm" disabled={sel.count === 0} onClick={() => setDialogOpen(true)}>
                Add to album
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={sel.count === 0 || deleting}
                onClick={() => void handleDelete()}
              >
                {deleting ? "Deleting…" : "Delete"}
              </Button>
            </>
          }
        />
      ) : (
        <HeaderBar
          title="Library"
          actions={
            <>
              <GridViewMenu mode={mode} onModeChange={setMode} />
              <Button variant="outline" size="sm" onClick={sel.enter}>
                Select
              </Button>
            </>
          }
        />
      )}

      {deleteError && <p className="mb-4 text-sm text-destructive">{deleteError}</p>}

      <PhotoGrid
        key={reloadKey}
        mode={mode}
        selectMode={sel.selectMode}
        selectedIds={sel.selected}
        onSelectionChange={sel.setSelected}
      />

      <AddToAlbumDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        photoIds={[...sel.selected]}
        onAdded={() => {
          setDialogOpen(false);
          sel.cancel();
        }}
      />
    </>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `cd apps/web && pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/(app)/photos/library-view.tsx"
git commit -m "feat(web): bulk move-to-trash in library view"
```

---

## Task 14: Bulk delete in the album view

**Files:**
- Modify: `apps/web/src/app/(app)/albums/[id]/album-view.tsx`

- [ ] **Step 1: Add the delete handler**

In `apps/web/src/app/(app)/albums/[id]/album-view.tsx`, add state next to the existing remove state (after line 38, `const [removeError, ...]`):

```tsx
  const [deleting, setDeleting] = useState(false);
```

Add a handler after `handleRemove` (after line 70):

```tsx
  async function handleDelete() {
    const ids = [...sel.selected];
    if (ids.length === 0 || deleting) return;
    const label = `${ids.length} ${ids.length === 1 ? "photo" : "photos"}`;
    if (!confirm(`Move ${label} to Trash? This removes them from your whole library.`)) return;
    setDeleting(true);
    setRemoveError(null);
    try {
      const res = await fetch("/api/photos/trash", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (res.ok) {
        sel.cancel();
        setReloadKey((k) => k + 1);
        router.refresh();
      } else {
        setRemoveError("Failed to move photos to Trash.");
      }
    } catch {
      setRemoveError("Failed to move photos to Trash.");
    } finally {
      setDeleting(false);
    }
  }
```

- [ ] **Step 2: Add the toolbar button**

In the `actions` of the `SelectionToolbar` (inside the `<>...</>`, after the `{!isSmart && (...)}` remove button block, around line 93), add:

```tsx
              <Button
                variant="destructive"
                size="sm"
                disabled={sel.count === 0 || deleting}
                onClick={() => void handleDelete()}
              >
                {deleting ? "Deleting…" : "Delete"}
              </Button>
```

- [ ] **Step 3: Typecheck**

Run: `cd apps/web && pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/(app)/albums/[id]/album-view.tsx"
git commit -m "feat(web): bulk move-to-trash in album view"
```

---

## Task 15: Trash page + sidebar link

**Files:**
- Create: `apps/web/src/app/(app)/trash/page.tsx`
- Create: `apps/web/src/app/(app)/trash/trash-view.tsx`
- Modify: `apps/web/src/components/sidebar-more.tsx`

- [ ] **Step 1: Create the client Trash view**

Create `apps/web/src/app/(app)/trash/trash-view.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useGridSelection } from "@/lib/use-grid-selection";
import { PhotoGrid } from "@/components/photo-grid/photo-grid";
import { HeaderBar } from "@/components/header-bar";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

const TRASH_EMPTY = (
  <Empty>
    <EmptyHeader>
      <EmptyMedia variant="icon">
        <Trash2 />
      </EmptyMedia>
      <EmptyTitle>Trash is empty</EmptyTitle>
      <EmptyDescription>
        Deleted photos appear here. Restore them or delete them permanently.
      </EmptyDescription>
    </EmptyHeader>
  </Empty>
);

export function TrashView() {
  const router = useRouter();
  const sel = useGridSelection();
  const [reloadKey, setReloadKey] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reload() {
    sel.clear();
    setReloadKey((k) => k + 1);
    router.refresh();
  }

  async function run(
    url: string,
    body: object | null,
    confirmMsg: string | null,
    failMsg: string,
  ) {
    if (confirmMsg && !confirm(confirmMsg)) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (res.ok) reload();
      else setError(failMsg);
    } catch {
      setError(failMsg);
    } finally {
      setPending(false);
    }
  }

  const ids = [...sel.selected];
  const count = sel.count;
  const label = `${count} ${count === 1 ? "photo" : "photos"}`;

  return (
    <>
      <HeaderBar
        title={count > 0 ? `${count} selected` : "Trash"}
        actions={
          <>
            {count > 0 && (
              <>
                <Button
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    void run("/api/trash/restore", { ids }, null, "Failed to restore photos.")
                  }
                >
                  Restore
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={pending}
                  onClick={() =>
                    void run(
                      "/api/trash/purge",
                      { ids },
                      `Permanently delete ${label}? This cannot be undone.`,
                      "Failed to delete photos.",
                    )
                  }
                >
                  Delete permanently
                </Button>
              </>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={pending}
              onClick={() =>
                void run(
                  "/api/trash/empty",
                  null,
                  "Empty Trash? This permanently deletes all trashed photos.",
                  "Failed to empty Trash.",
                )
              }
            >
              Empty trash
            </Button>
          </>
        }
      />

      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      <PhotoGrid
        key={reloadKey}
        endpoint="/api/trash"
        selectMode
        selectedIds={sel.selected}
        onSelectionChange={sel.setSelected}
        empty={TRASH_EMPTY}
      />
    </>
  );
}
```

- [ ] **Step 2: Create the server page**

Create `apps/web/src/app/(app)/trash/page.tsx`:

```tsx
import { TrashView } from "./trash-view";

export default function TrashPage() {
  return (
    <main className="w-full px-6 pb-6">
      <TrashView />
    </main>
  );
}
```

- [ ] **Step 3: Add the sidebar link**

In `apps/web/src/components/sidebar-more.tsx`, add `Trash2` to the lucide import (line 6):

```tsx
import { LogOut, Monitor, MoreHorizontal, Moon, Settings, Sun, Trash2 } from "lucide-react";
```

Then add a menu item right after the Settings `DropdownMenuItem` block (after line 67, before the `DropdownMenuSub`):

```tsx
        <DropdownMenuItem asChild>
          <Link href="/trash">
            <Trash2 aria-hidden />
            Trash
          </Link>
        </DropdownMenuItem>
```

- [ ] **Step 4: Typecheck**

Run: `cd apps/web && pnpm exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(app)/trash" apps/web/src/components/sidebar-more.tsx
git commit -m "feat(web): Trash page + sidebar link"
```

---

## Task 16: Full verification (lint, typecheck, tests, browser)

**Files:** none (verification only)

- [ ] **Step 1: Run the full web test suite**

Run: `cd apps/web && pnpm test`
Expected: PASS, including the new `trash-service.test.ts`.

- [ ] **Step 2: Run the db test suite**

Run: `cd packages/db && pnpm test`
Expected: PASS, including the new `toTrashedPhotoDTO` test.

- [ ] **Step 3: Lint + typecheck**

Run:

```bash
pnpm --filter @lumio/web lint
pnpm --filter @lumio/db typecheck
pnpm --filter @lumio/shared typecheck
cd apps/web && pnpm exec tsc --noEmit && cd ../..
```

Expected: no lint or type errors.

- [ ] **Step 4: Browser verification (the round-trip that matters)**

With the app + worker running (per the repo dev workflow), verify in the browser:

1. **Single delete:** open a photo → Move to Trash → it disappears from the grid.
2. **Bulk delete:** Select → pick several → Delete → they disappear.
3. **Trash page:** open Trash (More → Trash) → the deleted photos are listed with thumbnails.
4. **Restore:** select some in Trash → Restore → they return to the library (and to any album they were in — verify membership preserved).
5. **Permanent delete:** select in Trash → Delete permanently → gone from Trash; confirm the file is gone from `TRASH_DIR`.
6. **Empty trash:** Empty trash → Trash is empty.
7. **Watcher sanity:** after a delete, confirm the photo does not re-appear in the library (the watcher's `unlink` did not re-import). After a restore, confirm no duplicate row.

- [ ] **Step 5: Final commit (if any verification fixes were needed)**

```bash
git add -A
git commit -m "test(web): verify delete + trash end to end"
```

---

## Self-Review Notes (for the implementer)

- **Spec coverage:** Data model (Task 1), storage (Task 4), services + watcher coordination (Tasks 5–8), API (Tasks 9–11), UI single/bulk/Trash (Tasks 12–15), edge cases — path collision (Task 7), surviving albums (Task 7), missing files via `force`/`ENOENT` (Tasks 5,8) — all covered. Testing covered (Tasks 2,5–8,16).
- **Type consistency:** Service functions return `{ trashed }`, `{ restored }`, `{ deleted }`, and `PhotosPage`; routes pass them through. `photoIdsSchema` yields `{ ids }` used uniformly by all mutating routes. `toTrashedPhotoDTO` returns `PhotoDTO` so the Trash grid reuses `PhotoGrid` unchanged.
- **Watcher note:** No worker-code change is required. The web service deletes/recreates rows itself; the watcher's `unlink` (after trash) hits an already-removed row (no-op via `removePath`'s early return), and its `add` (after restore) upserts the row we recreated in place (`storePhoto` upserts on `path`).
