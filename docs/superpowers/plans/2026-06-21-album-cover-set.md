# Set as Album Cover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users pin a specific photo as a regular album's cover from the album view (toolbar + right-click menu), with the existing derived cover as the fallback when the pinned photo leaves the album.

**Architecture:** Add a nullable `Album.coverPhotoId` column. `listAlbumSummaries` returns the pinned cover only if it is still a member, else falls back to the current "most-recent by sortDate" derivation (this read-time check is what makes removal "default to something"). A `PATCH /api/albums/[id]` endpoint sets the pin; remove-from-album service functions eager-clear it. Client wires a `setAlbumCover` action through `usePhotoActions` into the album-view toolbar and the shared photo context menu.

**Tech Stack:** Next.js (App Router, `--webpack`), Prisma + PostgreSQL (port 5433), Zod, Vitest, React (with React Compiler lint), shadcn/ui, lucide-react, sonner toasts.

**Spec:** `docs/superpowers/specs/2026-06-21-album-cover-set-design.md`

**Conventions to honor (from CLAUDE.md / memory):**
- DB runs on port **5433**; bring it up with `pnpm db:up` before migrating.
- Don't edit `components/ui/*` (shadcn). Use TS `enum`s, not `as const` arrays, for new fixed sets (none needed here).
- React Compiler lint: `"use client"` must be line 1; no refs read in render; immutability.
- Tests are pure unit tests with hand-built `fakeDb` objects (no real DB) — see `apps/web/src/lib/albums-service.test.ts`.

---

## Task 1: Add `coverPhotoId` column + migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma:52-60` (the `Album` model)
- Generated: new dir under `packages/db/prisma/migrations/`

- [ ] **Step 1: Add the column to the `Album` model**

In `packages/db/prisma/schema.prisma`, change the `Album` model to add `coverPhotoId`:

```prisma
model Album {
  id           String       @id @default(cuid())
  name         String
  isSmart      Boolean      @default(false)
  rules        Json?
  coverPhotoId String? // explicitly pinned cover; null = use derived default
  createdAt    DateTime     @default(now())
  updatedAt    DateTime     @updatedAt
  photos       AlbumPhoto[]
}
```

(Plain nullable column — no relation. Correctness comes from the read-time membership check in Task 3.)

- [ ] **Step 2: Make sure the database is running**

Run: `pnpm db:up`
Expected: docker compose starts the `lumio` Postgres container (port 5433). Safe to re-run if already up.

- [ ] **Step 3: Create and apply the migration**

Run: `pnpm --filter @lumio/db migrate --name add_album_cover_photo_id`
Expected: Prisma creates `packages/db/prisma/migrations/<timestamp>_add_album_cover_photo_id/migration.sql` containing `ALTER TABLE "Album" ADD COLUMN "coverPhotoId" TEXT;`, applies it, and regenerates the Prisma client. No data loss prompt (the column is nullable).

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations
git commit -m "feat(db): add Album.coverPhotoId column"
```

---

## Task 2: Surface the pinned cover on `AlbumDTO`

**Files:**
- Modify: `packages/shared/src/types.ts:51-63` (`AlbumDTO` / `AlbumSummaryDTO`)
- Modify: `packages/db/src/mappers.ts:50-59` (`toAlbumDTO`)

- [ ] **Step 1: Add `coverPhotoId` to `AlbumDTO` and document the two meanings**

In `packages/shared/src/types.ts`, replace the `AlbumDTO` and `AlbumSummaryDTO` interfaces (lines 51-63) with:

```ts
export interface AlbumDTO {
  id: string;
  name: string;
  isSmart: boolean;
  rules: SmartAlbumRules | null;
  /** The explicitly pinned cover, raw from the row. null = no pin (use derived).
   *  This is the value the album-detail view uses for the "current cover" hint. */
  coverPhotoId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AlbumSummaryDTO extends AlbumDTO {
  photoCount: number;
  /** The EFFECTIVE cover: the pinned photo if it is still a member, otherwise
   *  the derived most-recent member. Same field name as AlbumDTO, resolved value —
   *  this is what the album grid card and sidebar render as the thumbnail. */
  coverPhotoId: string | null;
}
```

- [ ] **Step 2: Map the column in `toAlbumDTO`**

In `packages/db/src/mappers.ts`, add `coverPhotoId` to the object returned by `toAlbumDTO` (after `rules`):

```ts
export function toAlbumDTO(row: Album): AlbumDTO {
  return {
    id: row.id,
    name: row.name,
    isSmart: row.isSmart,
    rules: (row.rules as SmartAlbumRules | null) ?? null,
    coverPhotoId: row.coverPhotoId ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
```

- [ ] **Step 3: Typecheck shared + db**

Run: `pnpm --filter @lumio/shared exec tsc --noEmit && pnpm --filter @lumio/db exec tsc --noEmit`
Expected: PASS (the regenerated Prisma `Album` type now has `coverPhotoId`, so `row.coverPhotoId` typechecks).

- [ ] **Step 4: Commit**

```bash
git add packages/shared/src/types.ts packages/db/src/mappers.ts
git commit -m "feat(shared): surface Album.coverPhotoId on AlbumDTO"
```

---

## Task 3: `listAlbumSummaries` honors a valid pin, else falls back (TDD)

**Files:**
- Test: `apps/web/src/lib/albums-service.test.ts` (extend `albumRow` helper + add a `describe`)
- Modify: `apps/web/src/lib/albums-service.ts:15-40` (`listAlbumSummaries`)

- [ ] **Step 1: Add `coverPhotoId` to the test `albumRow` helper**

In `apps/web/src/lib/albums-service.test.ts`, update the `albumRow` helper (lines 14-31) so its overrides type and defaults include `coverPhotoId`:

```ts
function albumRow(overrides: Partial<{
  id: string;
  name: string;
  isSmart: boolean;
  rules: object | null;
  coverPhotoId: string | null;
  createdAt: Date;
  updatedAt: Date;
}> = {}) {
  return {
    id: "alb1",
    name: "Test Album",
    isSmart: false,
    rules: null,
    coverPhotoId: null,
    createdAt: new Date("2024-01-01T00:00:00.000Z"),
    updatedAt: new Date("2024-01-01T00:00:00.000Z"),
    ...overrides,
  };
}
```

- [ ] **Step 2: Write the failing tests for the pinned-cover behavior**

Add this `describe` block to `apps/web/src/lib/albums-service.test.ts` (e.g. right after the existing `listAlbumSummaries` describe, before `listAlbumPhotos`):

```ts
describe("listAlbumSummaries pinned cover", () => {
  it("uses the pinned coverPhotoId when it is still a member", async () => {
    const fakeDb = {
      album: { findMany: async () => [albumRow({ coverPhotoId: "pinned1" })] },
      albumPhoto: {
        count: async () => 5,
        // membership check for the pin returns a row → pin is valid
        findUnique: async () => ({ photoId: "pinned1" }),
        // derived fallback would return p9 if (incorrectly) used
        findFirst: async () => ({ photoId: "p9" }),
      },
      photo: { count: async () => 0, findFirst: async () => null },
    };
    const summaries = await listAlbumSummaries(fakeDb as never);
    expect(summaries[0]?.coverPhotoId).toBe("pinned1");
  });

  it("falls back to the derived cover when the pinned photo is no longer a member", async () => {
    const fakeDb = {
      album: { findMany: async () => [albumRow({ coverPhotoId: "gone" })] },
      albumPhoto: {
        count: async () => 5,
        findUnique: async () => null, // pinned photo not a member anymore
        findFirst: async () => ({ photoId: "p9" }), // derived most-recent
      },
      photo: { count: async () => 0, findFirst: async () => null },
    };
    const summaries = await listAlbumSummaries(fakeDb as never);
    expect(summaries[0]?.coverPhotoId).toBe("p9");
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter @lumio/web test albums-service`
Expected: FAIL — the first test currently gets `p9` (derivation ignores the pin); `albumPhoto.findUnique` is not yet called.

- [ ] **Step 4: Implement the pin-aware cover resolution**

In `apps/web/src/lib/albums-service.ts`, replace the regular-album branch of `listAlbumSummaries` (the body after the `if (a.isSmart)` block, lines 29-37) with:

```ts
      const photoCount = await db.albumPhoto.count({ where: { albumId: a.id } });
      let coverPhotoId: string | null = null;
      if (a.coverPhotoId) {
        const pinned = await db.albumPhoto.findUnique({
          where: { albumId_photoId: { albumId: a.id, photoId: a.coverPhotoId } },
          select: { photoId: true },
        });
        if (pinned) coverPhotoId = pinned.photoId;
      }
      if (!coverPhotoId) {
        const cover = await db.albumPhoto.findFirst({
          where: { albumId: a.id },
          orderBy: { photo: { sortDate: "desc" } },
          select: { photoId: true },
        });
        coverPhotoId = cover?.photoId ?? null;
      }
      return { ...base, photoCount, coverPhotoId };
```

Note: `base` comes from `toAlbumDTO(a)`, which now includes the pinned `coverPhotoId`; the line above overwrites it with the effective value. `a.coverPhotoId` is the raw Prisma row field.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @lumio/web test albums-service`
Expected: PASS — both new tests pass and the existing `listAlbumSummaries` tests (pin is null → skips `findUnique`, uses `findFirst`) still pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/albums-service.ts apps/web/src/lib/albums-service.test.ts
git commit -m "feat(albums): resolve pinned album cover with derived fallback"
```

---

## Task 4: `setAlbumCover` service + `PhotoNotInAlbumError` (TDD)

**Files:**
- Test: `apps/web/src/lib/albums-service.test.ts` (add a `describe`)
- Modify: `apps/web/src/lib/albums-service.ts` (add error class near line 123 + new function)

- [ ] **Step 1: Write the failing tests**

Add to the imports at the top of `apps/web/src/lib/albums-service.test.ts`:

```ts
import {
  addPhotosToAlbum,
  albumPhotoWhere,
  AlbumNotFoundError,
  deleteAlbums,
  listAlbumPhotos,
  listAlbumSummaries,
  PhotoNotInAlbumError,
  removePhotosFromAlbum,
  setAlbumCover,
  SmartAlbumMutationError,
} from "./albums-service.js";
```

Then add this `describe` block:

```ts
describe("setAlbumCover", () => {
  it("updates the album's coverPhotoId when the photo is a member", async () => {
    const update = vi.fn().mockResolvedValue({});
    const fakeDb = {
      album: { findUnique: async () => ({ isSmart: false }), update },
      albumPhoto: { findUnique: async () => ({ photoId: "p1" }) },
      photo: {},
    };
    await setAlbumCover("alb1", "p1", fakeDb as never);
    expect(update).toHaveBeenCalledWith({
      where: { id: "alb1" },
      data: { coverPhotoId: "p1" },
    });
  });

  it("throws AlbumNotFoundError when the album does not exist", async () => {
    const fakeDb = {
      album: { findUnique: async () => null, update: vi.fn() },
      albumPhoto: {},
      photo: {},
    };
    await expect(
      setAlbumCover("missing", "p1", fakeDb as never),
    ).rejects.toBeInstanceOf(AlbumNotFoundError);
  });

  it("throws SmartAlbumMutationError for smart albums", async () => {
    const fakeDb = {
      album: { findUnique: async () => ({ isSmart: true }), update: vi.fn() },
      albumPhoto: {},
      photo: {},
    };
    await expect(
      setAlbumCover("alb1", "p1", fakeDb as never),
    ).rejects.toBeInstanceOf(SmartAlbumMutationError);
  });

  it("throws PhotoNotInAlbumError when the photo is not a member", async () => {
    const fakeDb = {
      album: { findUnique: async () => ({ isSmart: false }), update: vi.fn() },
      albumPhoto: { findUnique: async () => null },
      photo: {},
    };
    await expect(
      setAlbumCover("alb1", "p1", fakeDb as never),
    ).rejects.toBeInstanceOf(PhotoNotInAlbumError);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @lumio/web test albums-service`
Expected: FAIL — `setAlbumCover` and `PhotoNotInAlbumError` are not exported.

- [ ] **Step 3: Implement the error class and the function**

In `apps/web/src/lib/albums-service.ts`, add the error class next to the existing ones (after line 125, `export class AlbumNotFoundError extends Error {}`):

```ts
export class PhotoNotInAlbumError extends Error {}
```

Then add the function (place it after `addPhotosToAlbum`, before `removePhotosFromAlbum`):

```ts
/**
 * Pin `photoId` as the album's cover. Regular albums only; the photo must already
 * be a member. The pin is honored by `listAlbumSummaries` only while the photo
 * stays a member (see the membership check there) and is eager-cleared on removal.
 */
export async function setAlbumCover(albumId: string, photoId: string, db: Db = prisma): Promise<void> {
  const album = await db.album.findUnique({ where: { id: albumId }, select: { isSmart: true } });
  if (!album) throw new AlbumNotFoundError();
  if (album.isSmart) throw new SmartAlbumMutationError("cannot set a cover on a smart album");
  const member = await db.albumPhoto.findUnique({
    where: { albumId_photoId: { albumId, photoId } },
    select: { photoId: true },
  });
  if (!member) throw new PhotoNotInAlbumError();
  await db.album.update({ where: { id: albumId }, data: { coverPhotoId: photoId } });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @lumio/web test albums-service`
Expected: PASS (all four new cases).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/albums-service.ts apps/web/src/lib/albums-service.test.ts
git commit -m "feat(albums): add setAlbumCover service"
```

---

## Task 5: Eager-clear the pin on remove-from-album (TDD)

**Files:**
- Test: `apps/web/src/lib/albums-service.test.ts` (extend the existing `removePhotosFromAlbum` describe + add a `removePhotoFromAlbum` describe)
- Modify: `apps/web/src/lib/albums-service.ts:127-129` (`removePhotoFromAlbum`) and `:146-158` (`removePhotosFromAlbum`)

- [ ] **Step 1: Add `setAlbumCover`-already-imported note + write the failing tests**

`removePhotoFromAlbum` is not yet imported in the test file. Add it to the import list edited in Task 4 (insert `removePhotoFromAlbum,` alphabetically, after `listAlbumSummaries,`).

Add a test to the existing `describe("removePhotosFromAlbum", ...)` block:

```ts
  it("clears the album cover pin if a removed photo was the cover", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const fakeDb = {
      album: { findUnique: async () => ({ isSmart: false }), updateMany },
      albumPhoto: { deleteMany: vi.fn().mockResolvedValue({ count: 2 }) },
      photo: {},
    };
    await removePhotosFromAlbum("alb1", ["p1", "p2"], fakeDb as never);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "alb1", coverPhotoId: { in: ["p1", "p2"] } },
      data: { coverPhotoId: null },
    });
  });
```

Add a new describe for the single-photo remover:

```ts
describe("removePhotoFromAlbum", () => {
  it("deletes the membership row and clears a matching cover pin", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const fakeDb = {
      album: { updateMany },
      albumPhoto: { deleteMany },
      photo: {},
    };
    await removePhotoFromAlbum("alb1", "p1", fakeDb as never);
    expect(deleteMany).toHaveBeenCalledWith({ where: { albumId: "alb1", photoId: "p1" } });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "alb1", coverPhotoId: "p1" },
      data: { coverPhotoId: null },
    });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @lumio/web test albums-service`
Expected: FAIL — `album.updateMany` is never called by the current implementations.

- [ ] **Step 3: Implement eager-clear in both removers**

In `apps/web/src/lib/albums-service.ts`, replace `removePhotoFromAlbum` (lines 127-129):

```ts
export async function removePhotoFromAlbum(albumId: string, photoId: string, db: Db = prisma): Promise<void> {
  await db.albumPhoto.deleteMany({ where: { albumId, photoId } });
  // If the removed photo was the pinned cover, drop the pin so the cover defaults
  // back to the derived most-recent member.
  await db.album.updateMany({
    where: { id: albumId, coverPhotoId: photoId },
    data: { coverPhotoId: null },
  });
}
```

Then, inside `removePhotosFromAlbum`, after the `deleteMany` call and before `return result.count;`:

```ts
  await db.album.updateMany({
    where: { id: albumId, coverPhotoId: { in: photoIds } },
    data: { coverPhotoId: null },
  });
```

(The conditional `where` means the update is a no-op when the pin isn't among the removed ids — no read needed.)

- [ ] **Step 4: Update the existing happy-path test's fakeDb to stub `updateMany`**

The existing `removePhotosFromAlbum` test "deleteMany on the given ids and returns the removed count" now reaches the new `album.updateMany` call, so its `fakeDb.album` must provide it. Update that test's `fakeDb` (currently `album: { findUnique: async () => ({ isSmart: false }) }`) to:

```ts
    const fakeDb = {
      album: { findUnique: async () => ({ isSmart: false }), updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      albumPhoto: { deleteMany },
      photo: {},
    };
```

The two "throws" tests short-circuit before `updateMany` (album missing → `AlbumNotFoundError`; smart → `SmartAlbumMutationError`), so they need no change.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm --filter @lumio/web test albums-service`
Expected: PASS — the new cases and all existing `removePhotosFromAlbum` cases pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/albums-service.ts apps/web/src/lib/albums-service.test.ts
git commit -m "feat(albums): clear cover pin when its photo leaves the album"
```

---

## Task 6: `setAlbumCoverSchema` zod schema (TDD)

**Files:**
- Test: `packages/shared/src/albums.test.ts` (add a `describe`)
- Modify: `packages/shared/src/albums.ts` (add schema + type after `albumPhotosSchema`, ~line 34)

- [ ] **Step 1: Write the failing test**

In `packages/shared/src/albums.test.ts`, add `setAlbumCoverSchema` to the import on line 2:

```ts
import { albumPhotosSchema, createAlbumSchema, deleteAlbumsSchema, setAlbumCoverSchema, smartRulesSchema } from "./albums.js";
```

Add this `describe`:

```ts
describe("setAlbumCoverSchema", () => {
  it("accepts a non-empty coverPhotoId", () => {
    expect(setAlbumCoverSchema.parse({ coverPhotoId: "p1" })).toEqual({ coverPhotoId: "p1" });
  });

  it("rejects an empty coverPhotoId", () => {
    expect(() => setAlbumCoverSchema.parse({ coverPhotoId: "" })).toThrow();
  });

  it("rejects a missing coverPhotoId", () => {
    expect(() => setAlbumCoverSchema.parse({})).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @lumio/shared test albums`
Expected: FAIL — `setAlbumCoverSchema` is not exported.

- [ ] **Step 3: Implement the schema**

In `packages/shared/src/albums.ts`, after the `albumPhotosSchema` block (line 34), add:

```ts
export const setAlbumCoverSchema = z.object({
  coverPhotoId: z.string().min(1),
});
export type SetAlbumCoverInput = z.infer<typeof setAlbumCoverSchema>;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @lumio/shared test albums`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/albums.ts packages/shared/src/albums.test.ts
git commit -m "feat(shared): add setAlbumCoverSchema"
```

---

## Task 7: `PATCH /api/albums/[id]` endpoint

**Files:**
- Modify: `apps/web/src/app/api/albums/[id]/route.ts`

No route handler tests exist in this app (verified: `find apps/web/src/app/api -name "*.test.ts"` is empty), so this thin handler is covered by the Task 4 service tests + the browser verification in Task 11.

- [ ] **Step 1: Add the PATCH handler**

In `apps/web/src/app/api/albums/[id]/route.ts`, update the imports and append a `PATCH` export. The full file becomes:

```ts
import { NextResponse } from "next/server";
import { setAlbumCoverSchema } from "@lumio/shared";
import {
  AlbumNotFoundError,
  deleteAlbum,
  getAlbum,
  PhotoNotInAlbumError,
  setAlbumCover,
  SmartAlbumMutationError,
} from "@/lib/albums-service";
import { withAuth } from "@/lib/with-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(
  async (_request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const album = await getAlbum(id);
    if (!album) {
      return NextResponse.json({ error: "Album not found" }, { status: 404 });
    }
    return NextResponse.json(album);
  },
);

export const PATCH = withAuth(
  async (request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const body: unknown = await request.json();
    const parsed = setAlbumCoverSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    try {
      await setAlbumCover(id, parsed.data.coverPhotoId);
      return NextResponse.json({ status: "ok" });
    } catch (err) {
      if (err instanceof AlbumNotFoundError) {
        return NextResponse.json({ error: "Album not found" }, { status: 404 });
      }
      if (err instanceof SmartAlbumMutationError || err instanceof PhotoNotInAlbumError) {
        return NextResponse.json({ error: (err as Error).message || "Bad request" }, { status: 400 });
      }
      throw err;
    }
  },
);

export const DELETE = withAuth(
  async (_request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    try {
      await deleteAlbum(id);
    } catch (err) {
      if (err instanceof AlbumNotFoundError) {
        return NextResponse.json({ error: "Album not found" }, { status: 404 });
      }
      throw err;
    }
    return new NextResponse(null, { status: 204 });
  },
);
```

- [ ] **Step 2: Lint the route**

Run: `pnpm --filter @lumio/web lint`
Expected: PASS (no eslint errors in the changed file).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/api/albums/[id]/route.ts
git commit -m "feat(api): PATCH /api/albums/[id] to set the cover photo"
```

---

## Task 8: `usePhotoActions` — `albumCover` config + `setAlbumCover` action

**Files:**
- Modify: `apps/web/src/components/photo-actions/use-photo-actions.tsx`

- [ ] **Step 1: Extend the `PhotoActions` interface**

In `apps/web/src/components/photo-actions/use-photo-actions.tsx`, add to the `PhotoActions` interface (inside the block at lines 15-30), after `excludeAlbumId?: string;`:

```ts
  /** Present only in a regular-album view: the album to set covers on, plus its
   *  current pinned cover (for the "current cover" menu hint). Absent elsewhere. */
  albumCover?: { albumId: string; coverPhotoId: string | null };
  /** Pin a single photo as the current album's cover. No-op without `albumCover`. */
  setAlbumCover: (photoId: string, opts?: ActionOpts) => Promise<void>;
```

- [ ] **Step 2: Accept `albumCover` as a hook parameter**

In the `usePhotoActions({ ... })` destructured parameter list and its type (lines 42-60), add `albumCover` after `excludeAlbumId`:

In the destructure:
```ts
  excludeAlbumId,
  albumCover,
```

In the param type object:
```ts
  /** Hide this album from the add-to-album list (the album being viewed). */
  excludeAlbumId?: string;
  /** Enable "set as album cover" for a regular album (see PhotoActions.albumCover). */
  albumCover?: { albumId: string; coverPhotoId: string | null };
```

- [ ] **Step 3: Implement the `setAlbumCover` action**

Add this `useCallback` after the `addToAlbumDirect` callback (after line 188), using the existing `router` and `toast`:

```ts
  const setAlbumCover = useCallback(
    async (photoId: string, opts?: ActionOpts) => {
      if (!albumCover) return;
      try {
        const res = await fetch(`/api/albums/${albumCover.albumId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ coverPhotoId: photoId }),
        });
        if (!res.ok) throw new Error("set cover failed");
        // Refresh so the card/sidebar thumbnails and the "current cover" menu
        // hint (seeded from the server) all update.
        router.refresh();
        toast.success("Album cover updated");
        opts?.onSuccess?.();
      } catch {
        toast.error("Failed to set the album cover.");
      }
    },
    [albumCover, router],
  );
```

- [ ] **Step 4: Return the new fields**

In the returned object (lines 208-218), add `albumCover` next to `excludeAlbumId`, and `setAlbumCover` next to `addToAlbumDirect`:

```ts
  return {
    download,
    applyLabel,
    trash,
    favorite,
    addToAlbum,
    addToAlbumDirect,
    setAlbumCover,
    excludeAlbumId,
    albumCover,
    pending: { download: downloading, label: labelPending, trash: deleting, favorite: favoritePending },
    element,
  };
```

- [ ] **Step 5: Typecheck the web app**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: PASS. (If `tsc --noEmit` is not configured for the app, run `pnpm --filter @lumio/web lint` instead, which type-aware-lints the changed files.)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/photo-actions/use-photo-actions.tsx
git commit -m "feat(web): setAlbumCover action in usePhotoActions"
```

---

## Task 9: Wire the album view — page prop, hook config, toolbar button

**Files:**
- Modify: `apps/web/src/app/(app)/albums/[id]/page.tsx:33`
- Modify: `apps/web/src/app/(app)/albums/[id]/album-view.tsx`

- [ ] **Step 1: Pass the pinned cover from the page**

In `apps/web/src/app/(app)/albums/[id]/page.tsx`, update the `AlbumView` render (line 33) to pass `coverPhotoId`:

```tsx
      <AlbumView
        albumId={album.id}
        albumName={album.name}
        isSmart={album.isSmart}
        coverPhotoId={album.coverPhotoId}
      />
```

(`album` is an `AlbumDTO` from `getAlbum`, which now carries `coverPhotoId` — the pinned value.)

- [ ] **Step 2: Add the `coverPhotoId` prop to `AlbumView` and feed `usePhotoActions`**

In `apps/web/src/app/(app)/albums/[id]/album-view.tsx`, add `coverPhotoId` to the component's props (lines 35-43):

```tsx
export function AlbumView({
  albumId,
  albumName,
  isSmart,
  coverPhotoId,
}: {
  albumId: string;
  albumName: string;
  isSmart: boolean;
  coverPhotoId: string | null;
}) {
```

Then pass `albumCover` into the `usePhotoActions({ ... })` call (lines 55-62) — only for regular albums so the action stays hidden in smart albums:

```tsx
  const actions = usePhotoActions({
    gridRef,
    excludeAlbumId: albumId,
    albumCover: isSmart ? undefined : { albumId, coverPhotoId },
    trashDescription: "This removes them from your whole library. You can restore them from Trash.",
    onTrashed: () => router.refresh(),
  });
```

- [ ] **Step 3: Add the import for the cover icon**

In the lucide import at the top of `album-view.tsx` (line 5), add `ImageUp`:

```tsx
import { Download, FolderMinus, Images, ImageUp, Loader2, Trash2 } from "lucide-react";
```

- [ ] **Step 4: Add the "Set as cover" toolbar button**

In `album-view.tsx`, inside the `SelectionToolbar` `actions` JSX, add the button immediately after the `<AddToAlbumMenu .../>` and before the `{!isSmart && ( ... Remove ... )}` block (around line 126). Wrap it in `!isSmart` so smart albums don't show it:

```tsx
              {!isSmart && (
                <Button
                  variant="outline"
                  size="icon-sm"
                  disabled={sel.count !== 1}
                  onClick={() => void actions.setAlbumCover([...sel.selected][0])}
                  aria-label="Set as album cover"
                  title="Set as album cover"
                >
                  <ImageUp aria-hidden />
                </Button>
              )}
```

(Per the spec: always visible in a regular album, enabled only when exactly one photo is selected. Selection is intentionally kept on success — it's a non-destructive tweak, like Favorite.)

- [ ] **Step 5: Lint + typecheck**

Run: `pnpm --filter @lumio/web lint`
Expected: PASS — no React-Compiler lint violations; `[...sel.selected][0]` is computed in the click handler, not in render.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/(app)/albums/[id]/page.tsx" "apps/web/src/app/(app)/albums/[id]/album-view.tsx"
git commit -m "feat(web): set-as-cover toolbar button in album view"
```

---

## Task 10: Context-menu "Set as album cover" item

**Files:**
- Modify: `apps/web/src/components/photo-grid/photo-context-menu.tsx`

- [ ] **Step 1: Import the cover icon**

In `apps/web/src/components/photo-grid/photo-context-menu.tsx`, add `ImageUp` to the lucide import (line 4):

```tsx
import { Download, FolderPlus, Heart, ImageUp, Palette, Trash2 } from "lucide-react";
```

- [ ] **Step 2: Add the menu item, with the three states**

In the `ContextMenuGroup` (after the Favorite `ContextMenuItem` at lines 118-121, still inside the group), add a cover item that only renders in a regular-album view (`actions.albumCover` present):

```tsx
          {actions.albumCover && (
            count === 1 && targetIds[0] === actions.albumCover.coverPhotoId ? (
              <ContextMenuItem disabled>
                <ImageUp aria-hidden />
                Current album cover
              </ContextMenuItem>
            ) : (
              <ContextMenuItem
                disabled={count !== 1}
                onSelect={() => void actions.setAlbumCover(targetIds[0])}
              >
                <ImageUp aria-hidden />
                Set as album cover
              </ContextMenuItem>
            )
          )}
```

This yields the three spec'd states: active "Set as album cover" (single non-cover target), disabled "Current album cover" (single target that is the pin), and disabled "Set as album cover" (multi-select). `actions.setAlbumCover` no-ops if `albumCover` is somehow absent, so the call is safe.

- [ ] **Step 3: Lint + typecheck**

Run: `pnpm --filter @lumio/web lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/photo-grid/photo-context-menu.tsx
git commit -m "feat(web): set-as-cover context-menu item with current-cover hint"
```

---

## Task 11: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test`
Expected: PASS across `@lumio/shared`, `@lumio/web`, and the rest — including the new albums-service and shared schema tests.

- [ ] **Step 2: Lint the whole web app**

Run: `pnpm --filter @lumio/web lint`
Expected: PASS, no warnings introduced.

- [ ] **Step 3: Browser-verify in a regular album** (DB up, `pnpm dev` running, signed in)

Confirm each:
- Open a regular album with ≥3 photos. Select exactly one → toolbar "Set as album cover" enables; click it → toast "Album cover updated".
- The album card (on `/albums`) and the sidebar album thumbnail now show that photo.
- Right-click that same photo → menu shows a disabled **"Current album cover"**. Right-click a different single photo → **"Set as album cover"** is active; clicking it moves the cover.
- Select two photos → toolbar button is **visible but disabled**; right-click within a 2+ selection → menu item is **disabled "Set as album cover"**.
- Remove the cover photo from the album (toolbar Remove). The album card/sidebar cover **falls back** to the derived most-recent photo (no broken thumbnail).
- Open a **smart** album → no "Set as album cover" in the toolbar or the context menu.

- [ ] **Step 4: Final commit (only if Step 3 surfaced fixes)**

```bash
git add -A
git commit -m "fix(web): address album-cover verification findings"
```

---

## Self-Review notes (already reconciled)

- **Spec coverage:** data model (T1), DTO dual-meaning (T2), read-path fallback (T3), set-cover service+API (T4/T6/T7), eager-clear on removal (T5), toolbar (T9), context-menu states + hint (T10), smart-album exclusion (T9/T10 via `albumCover` gating), tests + browser checks (T3–T6, T11). All covered.
- **Type consistency:** `setAlbumCover(photoId, opts?)` signature is identical in the interface (T8), hook return (T8), toolbar call (T9), and menu call (T10). `albumCover: { albumId, coverPhotoId }` shape is identical in interface, param, and consumers. `PhotoNotInAlbumError`, `setAlbumCoverSchema`, `coverPhotoId` field names match across service/API/shared/DTO.
- **No placeholders:** every code step shows complete code and exact commands.
