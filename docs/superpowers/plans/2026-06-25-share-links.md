# Share Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the admin select photos and create a public, unlisted share-link gallery (view + baked-edit downloads), with optional expiry/password, a global feature flag, and a required app-wide Public base URL setting.

**Architecture:** A dedicated, unauthenticated `/share/<token>` page + `/api/share/<token>/…` route group, guarded by a new `withShare` wrapper (mirrors `withCatalog`) that enforces feature-enabled → not-expired → password → photo-membership. Data lives in `ShareLink` + `ShareLinkPhoto` (mirrors `Album`/`AlbumPhoto`; live references via FK cascade). A generic `AppSetting` key/value table backs a new Settings → General page holding the required Public base URL. Authed surfaces: a Share button in the selection toolbar and a catalog-scoped "Shared" management page.

**Tech Stack:** Next.js 16 (App Router), Prisma + PostgreSQL (port 5433, **shared across worktrees**), Zod, better-auth (existing `BETTER_AUTH_SECRET`), `node:crypto` (scrypt + HMAC), vitest, shadcn/ui, sonner, lucide-react, thumbhash, archiver (via existing `streamPhotosZip`), sharp (via existing `encodeEditedJpeg`).

---

## Conventions recap (READ FIRST)

These are established patterns in this repo — follow them exactly. (Verbatim references gathered in `.context/settings-ui-report.md`.)

- **DB services take an injectable `db` param last, defaulting to `prisma`.** Type it `Pick<PrismaClient, "...delegates">`. Tests pass object-literal fakes cast `as never` — **no real DB in unit tests.**
- **Routes:** `export const runtime = "nodejs"; export const dynamic = "force-dynamic";`. Authed routes wrap `withAuth`/`withCatalog`. Validate bodies with `parseJson(request, schema)`; guard `if ("response" in parsed) return parsed.response;`. Map domain errors with `mapServiceError(err)`.
- **Imports use `.js` extensions** in `packages/*` (NodeNext). Web app uses `@/…` alias.
- **Enums:** prefer TS `enum` (see `FeatureKey`).
- **Migrations (shared DB!):** never reset. Author idempotent SQL by hand with `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` and inline FKs. Apply with `prisma migrate deploy`, not `migrate dev`.
- **Client mutations:** `postJson`/`patchJson` from `@/lib/http` (throw on non-OK; caller toasts) OR raw `fetch` when you need to read the error body. Toasts: `import { toast } from "sonner"`.
- **Settings pages:** `<main className="mx-auto max-w-3xl space-y-8 p-4 py-8">` + header block + `Card`s; toggle rows use `Field`/`Switch`.
- **"use client"` must be line 1** of client components. Never read `gridRef.current` during render.

**Test commands** (run from repo root):
- Single web file: `pnpm --filter @lumio/web exec vitest run src/path/to/file.test.ts`
- Single shared file: `pnpm --filter @lumio/shared exec vitest run src/path/to/file.test.ts`
- Whole package: `pnpm --filter @lumio/web test` (or `@lumio/shared`, `@lumio/db`)
- Lint web: `pnpm --filter @lumio/web lint`
- Typecheck shared/db: `pnpm --filter @lumio/shared typecheck` / `pnpm --filter @lumio/db typecheck` (web has no typecheck script — rely on lint + build)

**Commit after every task** with a `feat:`/`test:`/`chore:` message.

---

## File map

**Create:**
- `packages/db/prisma/migrations/20260626100000_add_share_links/migration.sql` — AppSetting + ShareLink + ShareLinkPhoto
- `packages/db/src/app-settings.ts` — `getAppSetting`/`setAppSetting`
- `packages/db/src/share-links.ts` — `toShareLinkRow` helpers (thin; most logic in web service)
- `packages/shared/src/app-settings.ts` — `PUBLIC_BASE_URL_KEY`, `normalizeBaseUrl`, `updateGeneralSettingsSchema`, `GeneralSettingsDTO`
- `packages/shared/src/share-links.ts` — `createShareLinkSchema`, `shareUnlockSchema`, `expiryPresetSchema`, `ShareLinkSummaryDTO`, `SharePhotoDTO`
- `apps/web/src/lib/server/share-crypto.ts` — token gen, password hash/verify, unlock-cookie sign/verify
- `apps/web/src/lib/server/app-settings-service.ts` — `getGeneralSettings`/`updateGeneralSettings`/`getPublicBaseUrl`
- `apps/web/src/lib/server/share-links-service.ts` — create/list/delete/resolve/list-photos/membership + domain errors
- `apps/web/src/lib/server/with-share.ts` — `withShare` wrapper + `SHARE_UNLOCK_COOKIE`
- `apps/web/src/lib/share-url.ts` — public client URL builders
- `apps/web/src/app/api/settings/general/route.ts` — GET/PUT public base URL
- `apps/web/src/app/api/c/[catalog]/share-links/route.ts` — POST create, GET list
- `apps/web/src/app/api/c/[catalog]/share-links/[id]/route.ts` — DELETE revoke
- `apps/web/src/app/api/share/[token]/photos/route.ts` — public list
- `apps/web/src/app/api/share/[token]/photos/[id]/thumbnail/route.ts`
- `apps/web/src/app/api/share/[token]/photos/[id]/display/route.ts`
- `apps/web/src/app/api/share/[token]/photos/[id]/download/route.ts`
- `apps/web/src/app/api/share/[token]/download-all/route.ts`
- `apps/web/src/app/api/share/[token]/unlock/route.ts`
- `apps/web/src/app/(app)/settings/general/page.tsx` + `general-settings-form.tsx`
- `apps/web/src/app/(app)/c/[catalog]/shared/page.tsx` + `shared-links-list.tsx`
- `apps/web/src/components/photo-actions/share-button.tsx` + `share-link-dialog.tsx`
- `apps/web/src/app/share/[token]/page.tsx` — public gallery entry (RSC)
- `apps/web/src/app/share/[token]/share-gallery.tsx` — public grid + viewer (client)
- `apps/web/src/app/share/[token]/share-password-gate.tsx` (client)
- `apps/web/src/app/share/[token]/share-unavailable.tsx`
- Test files alongside each service/schema/crypto module (`*.test.ts`).

**Modify:**
- `packages/db/prisma/schema.prisma` — add models + relations on `Catalog`/`Photo`
- `packages/db/src/index.ts` — export new modules + types
- `packages/shared/src/index.ts` — export new modules
- `packages/shared/src/features.ts` — add `FeatureKey.Sharing` + `FEATURES` entry
- `apps/web/src/lib/api-paths.ts` — add `settingsGeneral`
- `apps/web/src/components/settings-sidebar.tsx` — add General nav item
- `apps/web/src/components/app-sidebar.tsx` — add feature-gated "Shared" nav item
- `apps/web/src/app/(app)/c/[catalog]/photos/library-view.tsx` — pass `selectionActions` Share button
- `apps/web/src/lib/server/route-helpers.ts` — register `ShareLinkNotFoundError` in `mapServiceError`

---

# Phase 1 — Data model & DB layer

### Task 1: Add Prisma models + relations

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add the three models** at the end of `schema.prisma` (after `WorkerLog`):

```prisma
model AppSetting {
  key       String   @id
  value     String
  updatedAt DateTime @updatedAt
}

model ShareLink {
  id           String           @id @default(cuid())
  token        String           @unique
  catalogId    String
  catalog      Catalog          @relation(fields: [catalogId], references: [id], onDelete: Cascade)
  title        String?
  passwordHash String?
  expiresAt    DateTime?
  createdAt    DateTime         @default(now())
  updatedAt    DateTime         @updatedAt
  photos       ShareLinkPhoto[]

  @@index([catalogId])
}

model ShareLinkPhoto {
  shareLinkId String
  shareLink   ShareLink @relation(fields: [shareLinkId], references: [id], onDelete: Cascade)
  photoId     String
  photo       Photo     @relation(fields: [photoId], references: [id], onDelete: Cascade)

  @@id([shareLinkId, photoId])
  @@index([photoId])
}
```

- [ ] **Step 2: Add the back-relations.** In `model Catalog`, add a line in the relations block (after `featureSettings FeatureSetting[]`):

```prisma
  shareLinks      ShareLink[]
```

In `model Photo`, add after `albums         AlbumPhoto[]`:

```prisma
  shareLinks     ShareLinkPhoto[]
```

- [ ] **Step 3: Generate the Prisma client** (no DB write):

Run: `pnpm --filter @lumio/db generate`
Expected: `Generated Prisma Client` success, no errors. (If it complains about the relation, re-check the back-relation field names.)

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/schema.prisma
git commit -m "feat: add ShareLink, ShareLinkPhoto, AppSetting prisma models"
```

---

### Task 2: Author the idempotent migration & apply it

**Files:**
- Create: `packages/db/prisma/migrations/20260626100000_add_share_links/migration.sql`

> The dev DB is shared across worktrees — author SQL idempotently and apply with `migrate deploy` (never `migrate dev`, which may try to reset).

- [ ] **Step 1: Create the migration directory and file** with this exact content:

```sql
-- CreateTable
CREATE TABLE IF NOT EXISTS "AppSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ShareLink" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "catalogId" TEXT NOT NULL,
    "title" TEXT,
    "passwordHash" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShareLink_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ShareLink_catalogId_fkey" FOREIGN KEY ("catalogId") REFERENCES "Catalog"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ShareLinkPhoto" (
    "shareLinkId" TEXT NOT NULL,
    "photoId" TEXT NOT NULL,

    CONSTRAINT "ShareLinkPhoto_pkey" PRIMARY KEY ("shareLinkId", "photoId"),
    CONSTRAINT "ShareLinkPhoto_shareLinkId_fkey" FOREIGN KEY ("shareLinkId") REFERENCES "ShareLink"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ShareLinkPhoto_photoId_fkey" FOREIGN KEY ("photoId") REFERENCES "Photo"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ShareLink_token_key" ON "ShareLink"("token");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ShareLink_catalogId_idx" ON "ShareLink"("catalogId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ShareLinkPhoto_photoId_idx" ON "ShareLinkPhoto"("photoId");
```

- [ ] **Step 2: Apply the migration to the shared DB** (records it as applied; idempotent if tables exist):

Run: `pnpm --filter @lumio/db exec dotenv -e ../../.env -- prisma migrate deploy`
Expected: output lists `20260626100000_add_share_links` as applied, ends with `All migrations have been successfully applied.` (or "No pending migrations" if a sibling worktree already ran it — fine).

- [ ] **Step 3: Verify the client + DB agree** with a throwaway query:

Run: `pnpm --filter @lumio/db exec dotenv -e ../../.env -- node -e "const{PrismaClient}=require('@prisma/client');const p=new PrismaClient();p.shareLink.count().then(n=>{console.log('shareLink rows:',n);return p.appSetting.count()}).then(n=>{console.log('appSetting rows:',n);process.exit(0)}).catch(e=>{console.error(e);process.exit(1)})"`
Expected: prints `shareLink rows: 0` and `appSetting rows: 0` (numbers may be >0 if a sibling branch seeded; the point is no error).

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/migrations/20260626100000_add_share_links/migration.sql
git commit -m "feat: add share-links migration (idempotent for shared dev DB)"
```

---

### Task 3: AppSetting db accessors

**Files:**
- Create: `packages/db/src/app-settings.ts`
- Test: `packages/db/src/app-settings.test.ts`
- Modify: `packages/db/src/index.ts`

- [ ] **Step 1: Write the failing test** (`app-settings.test.ts`):

```ts
import { describe, expect, it, vi } from "vitest";
import { getAppSetting, setAppSetting } from "./app-settings.js";

describe("getAppSetting", () => {
  it("returns the value when a row exists", async () => {
    const findUnique = vi.fn().mockResolvedValue({ key: "publicBaseUrl", value: "https://x.test" });
    const db = { appSetting: { findUnique } };
    expect(await getAppSetting("publicBaseUrl", db as never)).toBe("https://x.test");
    expect(findUnique).toHaveBeenCalledWith({ where: { key: "publicBaseUrl" } });
  });

  it("returns null when no row exists", async () => {
    const db = { appSetting: { findUnique: async () => null } };
    expect(await getAppSetting("publicBaseUrl", db as never)).toBeNull();
  });
});

describe("setAppSetting", () => {
  it("upserts the key/value", async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    const db = { appSetting: { upsert } };
    await setAppSetting("publicBaseUrl", "https://x.test", db as never);
    expect(upsert).toHaveBeenCalledWith({
      where: { key: "publicBaseUrl" },
      create: { key: "publicBaseUrl", value: "https://x.test" },
      update: { value: "https://x.test" },
    });
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm --filter @lumio/db exec vitest run src/app-settings.test.ts`
Expected: FAIL — cannot find module `./app-settings.js`.

- [ ] **Step 3: Implement** (`app-settings.ts`):

```ts
import type { PrismaClient } from "@prisma/client";
import { prisma } from "./client.js";

type AppSettingDb = Pick<PrismaClient, "appSetting">;

export async function getAppSetting(key: string, db: AppSettingDb = prisma): Promise<string | null> {
  const row = await db.appSetting.findUnique({ where: { key } });
  return row?.value ?? null;
}

export async function setAppSetting(key: string, value: string, db: AppSettingDb = prisma): Promise<void> {
  await db.appSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}
```

- [ ] **Step 4: Export from `packages/db/src/index.ts`.** Add after the `export * from "./features.js";` line:

```ts
export * from "./app-settings.js";
export * from "./share-links.js";
```

And extend the type export line to include the new model types:

```ts
export type { Photo, Album, AlbumPhoto, Folder, TrashedPhoto, Job, WorkerStatus, WorkerLog, Catalog, UserSettings, ShareLink, ShareLinkPhoto, AppSetting, PrismaClient } from "@prisma/client";
```

(Create an empty stub `packages/db/src/share-links.ts` now so the export resolves — it gets content in Task 4:)

```ts
// share-links db helpers (filled in Task 4)
export {};
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter @lumio/db exec vitest run src/app-settings.test.ts && pnpm --filter @lumio/db typecheck`
Expected: tests PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/app-settings.ts packages/db/src/app-settings.test.ts packages/db/src/share-links.ts packages/db/src/index.ts
git commit -m "feat: add AppSetting db accessors"
```

---

### Task 4: ShareLink db query helpers

**Files:**
- Modify: `packages/db/src/share-links.ts`
- Test: `packages/db/src/share-links.test.ts`

These are the thin, Prisma-touching helpers the web service composes. (The richer business logic lives in `apps/web/src/lib/server/share-links-service.ts`.)

- [ ] **Step 1: Write the failing test** (`share-links.test.ts`):

```ts
import { describe, expect, it, vi } from "vitest";
import { findShareLinkByToken, deleteShareLink, shareLinkPhotoExists } from "./share-links.js";

describe("findShareLinkByToken", () => {
  it("looks up by unique token", async () => {
    const row = { id: "s1", token: "tok", catalogId: "c1" };
    const findUnique = vi.fn().mockResolvedValue(row);
    const db = { shareLink: { findUnique } };
    expect(await findShareLinkByToken("tok", db as never)).toBe(row);
    expect(findUnique).toHaveBeenCalledWith({ where: { token: "tok" } });
  });
});

describe("deleteShareLink", () => {
  it("scopes the delete to the catalog and reports the count", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const db = { shareLink: { deleteMany } };
    expect(await deleteShareLink("c1", "s1", db as never)).toBe(1);
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: "s1", catalogId: "c1" } });
  });
});

describe("shareLinkPhotoExists", () => {
  it("returns true when a membership row is found", async () => {
    const db = { shareLinkPhoto: { findUnique: async () => ({ shareLinkId: "s1", photoId: "p1" }) } };
    expect(await shareLinkPhotoExists("s1", "p1", db as never)).toBe(true);
  });
  it("returns false when none", async () => {
    const db = { shareLinkPhoto: { findUnique: async () => null } };
    expect(await shareLinkPhotoExists("s1", "p1", db as never)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @lumio/db exec vitest run src/share-links.test.ts`
Expected: FAIL — exports not found.

- [ ] **Step 3: Implement** (replace the stub in `share-links.ts`):

```ts
import type { Prisma, PrismaClient, ShareLink } from "@prisma/client";
import { prisma } from "./client.js";

type ShareLinkDb = Pick<PrismaClient, "shareLink">;
type ShareLinkPhotoDb = Pick<PrismaClient, "shareLinkPhoto">;

export function findShareLinkByToken(token: string, db: ShareLinkDb = prisma): Promise<ShareLink | null> {
  return db.shareLink.findUnique({ where: { token } });
}

export function listShareLinksForCatalog(catalogId: string, db: ShareLinkDb = prisma): Promise<ShareLink[]> {
  return db.shareLink.findMany({ where: { catalogId }, orderBy: { createdAt: "desc" } });
}

/** Delete a link scoped to its catalog. Returns rows removed (0 = not found). */
export async function deleteShareLink(catalogId: string, id: string, db: ShareLinkDb = prisma): Promise<number> {
  const { count } = await db.shareLink.deleteMany({ where: { id, catalogId } });
  return count;
}

export async function shareLinkPhotoExists(
  shareLinkId: string,
  photoId: string,
  db: ShareLinkPhotoDb = prisma,
): Promise<boolean> {
  const row = await db.shareLinkPhoto.findUnique({
    where: { shareLinkId_photoId: { shareLinkId, photoId } },
    select: { photoId: true },
  });
  return row !== null;
}

/** Prisma `where` selecting a share link's member photos (for listing/zip). */
export function shareLinkPhotoWhere(shareLinkId: string): Prisma.PhotoWhereInput {
  return { shareLinks: { some: { shareLinkId } } };
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @lumio/db exec vitest run src/share-links.test.ts && pnpm --filter @lumio/db typecheck`
Expected: PASS + clean.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/share-links.ts packages/db/src/share-links.test.ts
git commit -m "feat: add ShareLink db query helpers"
```

---

# Phase 2 — Shared schemas & types

### Task 5: App-settings shared module (base-URL validation)

**Files:**
- Create: `packages/shared/src/app-settings.ts`
- Test: `packages/shared/src/app-settings.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write the failing test** (`app-settings.test.ts`):

```ts
import { describe, expect, it } from "vitest";
import { normalizeBaseUrl, updateGeneralSettingsSchema } from "./app-settings.js";

describe("normalizeBaseUrl", () => {
  it("keeps a valid https origin", () => {
    expect(normalizeBaseUrl("https://photos.example.com")).toBe("https://photos.example.com");
  });
  it("trims a trailing slash", () => {
    expect(normalizeBaseUrl("https://photos.example.com/")).toBe("https://photos.example.com");
  });
  it("preserves a sub-path without trailing slash", () => {
    expect(normalizeBaseUrl("https://example.com/lumio/")).toBe("https://example.com/lumio");
  });
  it("accepts http", () => {
    expect(normalizeBaseUrl("http://localhost:3000")).toBe("http://localhost:3000");
  });
  it("rejects non-http(s) protocols", () => {
    expect(normalizeBaseUrl("ftp://x.test")).toBeNull();
  });
  it("rejects garbage", () => {
    expect(normalizeBaseUrl("not a url")).toBeNull();
  });
  it("treats empty/whitespace as null", () => {
    expect(normalizeBaseUrl("   ")).toBeNull();
  });
});

describe("updateGeneralSettingsSchema", () => {
  it("accepts a string", () => {
    expect(updateGeneralSettingsSchema.parse({ publicBaseUrl: " https://x.test " })).toEqual({
      publicBaseUrl: "https://x.test",
    });
  });
  it("accepts an empty string (to clear)", () => {
    expect(updateGeneralSettingsSchema.parse({ publicBaseUrl: "" })).toEqual({ publicBaseUrl: "" });
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @lumio/shared exec vitest run src/app-settings.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** (`app-settings.ts`):

```ts
import { z } from "zod";

/** AppSetting key for the app-wide public base URL (used to build share links). */
export const PUBLIC_BASE_URL_KEY = "publicBaseUrl";

/**
 * Validate + normalize a public base URL. Returns the canonical
 * `<protocol>//<host>[<path>]` form (no trailing slash), or null if the input
 * is empty or not a valid http(s) URL.
 */
export function normalizeBaseUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${path}`;
}

/** Body for PUT /api/settings/general. Empty string clears the setting. */
export const updateGeneralSettingsSchema = z.object({
  publicBaseUrl: z.string().trim().max(2000),
});
export type UpdateGeneralSettingsInput = z.infer<typeof updateGeneralSettingsSchema>;

export interface GeneralSettingsDTO {
  publicBaseUrl: string | null;
}
```

- [ ] **Step 4: Export** — add to `packages/shared/src/index.ts` (after `export * from "./profile.js";`):

```ts
export * from "./app-settings.js";
export * from "./share-links.js";
```

(Add a stub `packages/shared/src/share-links.ts` now so the export resolves — replaced in Task 6:)

```ts
export {};
```

- [ ] **Step 5: Run tests + typecheck**

Run: `pnpm --filter @lumio/shared exec vitest run src/app-settings.test.ts && pnpm --filter @lumio/shared typecheck`
Expected: PASS + clean.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/app-settings.ts packages/shared/src/app-settings.test.ts packages/shared/src/share-links.ts packages/shared/src/index.ts
git commit -m "feat: add shared app-settings module with base-URL validation"
```

---

### Task 6: Share-links shared schemas & DTOs

**Files:**
- Modify: `packages/shared/src/share-links.ts`
- Test: `packages/shared/src/share-links.test.ts`

- [ ] **Step 1: Write the failing test** (`share-links.test.ts`):

```ts
import { describe, expect, it } from "vitest";
import { createShareLinkSchema } from "./share-links.js";

describe("createShareLinkSchema", () => {
  it("accepts a minimal body (just photoIds)", () => {
    const v = createShareLinkSchema.parse({ photoIds: ["p1", "p2"] });
    expect(v.photoIds).toEqual(["p1", "p2"]);
    expect(v.title).toBeUndefined();
    expect(v.password).toBeUndefined();
    expect(v.expiresAt).toBeUndefined();
  });
  it("accepts title, password and an ISO expiry", () => {
    const v = createShareLinkSchema.parse({
      photoIds: ["p1"],
      title: "Wedding",
      password: "hunter2",
      expiresAt: "2026-12-31T00:00:00.000Z",
    });
    expect(v.title).toBe("Wedding");
    expect(v.password).toBe("hunter2");
    expect(v.expiresAt).toBe("2026-12-31T00:00:00.000Z");
  });
  it("rejects an empty photoIds array", () => {
    expect(() => createShareLinkSchema.parse({ photoIds: [] })).toThrow();
  });
  it("rejects a non-ISO expiry", () => {
    expect(() => createShareLinkSchema.parse({ photoIds: ["p1"], expiresAt: "soon" })).toThrow();
  });
  it("treats empty title/password as omitted", () => {
    const v = createShareLinkSchema.parse({ photoIds: ["p1"], title: "  ", password: "" });
    expect(v.title).toBeUndefined();
    expect(v.password).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @lumio/shared exec vitest run src/share-links.test.ts`
Expected: FAIL — `createShareLinkSchema` not exported.

- [ ] **Step 3: Implement** (replace the stub in `share-links.ts`):

```ts
import { z } from "zod";

/** Empty-or-whitespace strings collapse to undefined (treated as "not set"). */
const optionalTrimmed = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

/** Body for POST /api/c/[catalog]/share-links. */
export const createShareLinkSchema = z.object({
  photoIds: z.array(z.string().min(1)).min(1),
  title: optionalTrimmed(200),
  password: optionalTrimmed(200),
  expiresAt: z.string().datetime().nullish().transform((v) => v ?? undefined),
});
export type CreateShareLinkInput = z.infer<typeof createShareLinkSchema>;

/** Body for POST /api/share/[token]/unlock. */
export const shareUnlockSchema = z.object({
  password: z.string().min(1),
});
export type ShareUnlockInput = z.infer<typeof shareUnlockSchema>;

/** One share link as shown in the management list and returned on create. */
export interface ShareLinkSummaryDTO {
  id: string;
  token: string;
  url: string;
  title: string | null;
  hasPassword: boolean;
  expiresAt: string | null;
  isExpired: boolean;
  photoCount: number;
  coverPhotoId: string | null;
  createdAt: string;
}
```

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @lumio/shared exec vitest run src/share-links.test.ts && pnpm --filter @lumio/shared typecheck`
Expected: PASS + clean.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/share-links.ts packages/shared/src/share-links.test.ts
git commit -m "feat: add share-links shared schemas and DTO"
```

---

### Task 7: Register the Sharing feature flag

**Files:**
- Modify: `packages/shared/src/features.ts`
- Test: `packages/shared/src/features.test.ts` (if it exists; else create a small one)

- [ ] **Step 1: Add the enum member.** In `FeatureKey`:

```ts
export enum FeatureKey {
  DiskExplorer = "diskExplorer",
  Sharing = "sharing",
}
```

- [ ] **Step 2: Add the registry entry.** In `FEATURES`, after the `DiskExplorer` block:

```ts
  [FeatureKey.Sharing]: {
    key: FeatureKey.Sharing,
    label: "Share links",
    description: "Create public links to share selected photos. Requires a Public base URL in General settings.",
    scopes: [FeatureScope.Global],
    default: false,
  },
```

- [ ] **Step 3: Add/extend a test** asserting the registry is consistent. Create or append to `packages/shared/src/features.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ALL_FEATURE_KEYS, FEATURES, FeatureKey, FeatureScope } from "./features.js";

describe("FEATURES registry", () => {
  it("every key has a matching def keyed by itself", () => {
    for (const key of ALL_FEATURE_KEYS) {
      expect(FEATURES[key].key).toBe(key);
    }
  });
  it("Sharing is a global-only feature, default off", () => {
    expect(FEATURES[FeatureKey.Sharing].scopes).toEqual([FeatureScope.Global]);
    expect(FEATURES[FeatureKey.Sharing].default).toBe(false);
  });
});
```

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @lumio/shared exec vitest run src/features.test.ts && pnpm --filter @lumio/shared typecheck`
Expected: PASS + clean. (`FEATURES` is `Record<FeatureKey, FeatureDef>`, so the typecheck enforces the new member is present — a good guard.)

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/features.ts packages/shared/src/features.test.ts
git commit -m "feat: register global Sharing feature flag"
```

---

# Phase 3 — Server crypto

### Task 8: Share crypto utilities (token, password, unlock cookie)

**Files:**
- Create: `apps/web/src/lib/server/share-crypto.ts`
- Test: `apps/web/src/lib/server/share-crypto.test.ts`

- [ ] **Step 1: Write the failing test** (`share-crypto.test.ts`):

```ts
import { describe, expect, it, beforeAll } from "vitest";
import {
  generateShareToken,
  hashPassword,
  verifyPassword,
  signUnlock,
  verifyUnlock,
} from "./share-crypto.js";

beforeAll(() => {
  process.env.BETTER_AUTH_SECRET ??= "test-secret-for-share-crypto";
});

describe("generateShareToken", () => {
  it("produces a URL-safe token of usable length, unique per call", () => {
    const a = generateShareToken();
    const b = generateShareToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeGreaterThanOrEqual(24);
    expect(a).not.toBe(b);
  });
});

describe("password hash/verify", () => {
  it("verifies the correct password and rejects a wrong one", async () => {
    const stored = await hashPassword("hunter2");
    expect(stored).toContain(":");
    expect(await verifyPassword("hunter2", stored)).toBe(true);
    expect(await verifyPassword("nope", stored)).toBe(false);
  });
  it("rejects a malformed stored value", async () => {
    expect(await verifyPassword("x", "garbage")).toBe(false);
  });
});

describe("unlock signature", () => {
  it("round-trips for the same token and rejects a different token or bad sig", () => {
    const sig = signUnlock("tok-1");
    expect(verifyUnlock("tok-1", sig)).toBe(true);
    expect(verifyUnlock("tok-2", sig)).toBe(false);
    expect(verifyUnlock("tok-1", "deadbeef")).toBe(false);
    expect(verifyUnlock("tok-1", "")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @lumio/web exec vitest run src/lib/server/share-crypto.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** (`share-crypto.ts`):

> Do NOT add `import "server-only"` here — this module has unit tests, and `server-only` throws under vitest's default resolution. It's only ever imported by server routes, so the guard isn't needed.

```ts
import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb);
const KEY_LEN = 64;

/** A high-entropy, URL-safe share token (~192 bits). */
export function generateShareToken(): string {
  return randomBytes(24).toString("base64url");
}

/** scrypt hash, stored as "<saltHex>:<keyHex>". */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = (await scrypt(password, salt, KEY_LEN)) as Buffer;
  return `${salt.toString("hex")}:${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, keyHex] = stored.split(":");
  if (!saltHex || !keyHex) return false;
  let expected: Buffer;
  try {
    expected = Buffer.from(keyHex, "hex");
  } catch {
    return false;
  }
  if (expected.length === 0) return false;
  const test = (await scrypt(password, Buffer.from(saltHex, "hex"), expected.length)) as Buffer;
  return expected.length === test.length && timingSafeEqual(expected, test);
}

function secret(): string {
  const s = process.env.BETTER_AUTH_SECRET;
  if (!s) throw new Error("BETTER_AUTH_SECRET is not set");
  return s;
}

/** HMAC proving "the password for <token> was entered". Stored as the cookie value. */
export function signUnlock(token: string): string {
  return createHmac("sha256", secret()).update(`share-unlock:${token}`).digest("hex");
}

export function verifyUnlock(token: string, signature: string): boolean {
  if (!signature) return false;
  const expected = signUnlock(token);
  const a = Buffer.from(expected, "hex");
  let b: Buffer;
  try {
    b = Buffer.from(signature, "hex");
  } catch {
    return false;
  }
  return a.length === b.length && timingSafeEqual(a, b);
}
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @lumio/web exec vitest run src/lib/server/share-crypto.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/server/share-crypto.ts apps/web/src/lib/server/share-crypto.test.ts
git commit -m "feat: add share-link crypto (token, scrypt password, HMAC unlock)"
```

---

# Phase 4 — App-settings service & General settings page

### Task 9: App-settings service

**Files:**
- Create: `apps/web/src/lib/server/app-settings-service.ts`
- Test: `apps/web/src/lib/server/app-settings-service.test.ts`

- [ ] **Step 1: Write the failing test**:

```ts
import { describe, expect, it, vi } from "vitest";
import { getGeneralSettings, updateGeneralSettings, InvalidBaseUrlError } from "./app-settings-service.js";

describe("getGeneralSettings", () => {
  it("returns the stored base URL", async () => {
    const db = { appSetting: { findUnique: async () => ({ key: "publicBaseUrl", value: "https://x.test" }) } };
    expect(await getGeneralSettings(db as never)).toEqual({ publicBaseUrl: "https://x.test" });
  });
  it("returns null when unset", async () => {
    const db = { appSetting: { findUnique: async () => null } };
    expect(await getGeneralSettings(db as never)).toEqual({ publicBaseUrl: null });
  });
});

describe("updateGeneralSettings", () => {
  it("normalizes and stores a valid URL", async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    const db = { appSetting: { upsert } };
    const result = await updateGeneralSettings({ publicBaseUrl: "https://x.test/" }, db as never);
    expect(result).toEqual({ publicBaseUrl: "https://x.test" });
    expect(upsert).toHaveBeenCalledWith({
      where: { key: "publicBaseUrl" },
      create: { key: "publicBaseUrl", value: "https://x.test" },
      update: { value: "https://x.test" },
    });
  });
  it("clears the setting on empty input", async () => {
    const upsert = vi.fn().mockResolvedValue(undefined);
    const db = { appSetting: { upsert } };
    const result = await updateGeneralSettings({ publicBaseUrl: "" }, db as never);
    expect(result).toEqual({ publicBaseUrl: null });
    expect(upsert).toHaveBeenCalledWith({
      where: { key: "publicBaseUrl" },
      create: { key: "publicBaseUrl", value: "" },
      update: { value: "" },
    });
  });
  it("throws InvalidBaseUrlError on a bad URL", async () => {
    const db = { appSetting: { upsert: vi.fn() } };
    await expect(updateGeneralSettings({ publicBaseUrl: "not a url" }, db as never)).rejects.toBeInstanceOf(
      InvalidBaseUrlError,
    );
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @lumio/web exec vitest run src/lib/server/app-settings-service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** (`app-settings-service.ts`):

```ts
import { type PrismaClient, prisma, getAppSetting, setAppSetting } from "@lumio/db";
import {
  PUBLIC_BASE_URL_KEY,
  normalizeBaseUrl,
  type GeneralSettingsDTO,
  type UpdateGeneralSettingsInput,
} from "@lumio/shared";

type Db = Pick<PrismaClient, "appSetting">;

export class InvalidBaseUrlError extends Error {
  constructor(message = "Public base URL must be a valid http(s) URL") {
    super(message);
  }
}

export async function getGeneralSettings(db: Db = prisma): Promise<GeneralSettingsDTO> {
  const publicBaseUrl = await getAppSetting(PUBLIC_BASE_URL_KEY, db);
  return { publicBaseUrl: publicBaseUrl ?? null };
}

export async function updateGeneralSettings(
  input: UpdateGeneralSettingsInput,
  db: Db = prisma,
): Promise<GeneralSettingsDTO> {
  const raw = input.publicBaseUrl.trim();
  if (raw === "") {
    await setAppSetting(PUBLIC_BASE_URL_KEY, "", db);
    return { publicBaseUrl: null };
  }
  const normalized = normalizeBaseUrl(raw);
  if (normalized === null) throw new InvalidBaseUrlError();
  await setAppSetting(PUBLIC_BASE_URL_KEY, normalized, db);
  return { publicBaseUrl: normalized };
}

/** The configured base URL, or null. Used by share-link creation. */
export async function getPublicBaseUrl(db: Db = prisma): Promise<string | null> {
  const value = await getAppSetting(PUBLIC_BASE_URL_KEY, db);
  return value ? value : null;
}
```

> `prisma` is imported lazily and doesn't open a connection at import time, so it's safe in unit-tested modules (matches `albums-service.ts`). Tests still inject a fake `db`.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @lumio/web exec vitest run src/lib/server/app-settings-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/server/app-settings-service.ts apps/web/src/lib/server/app-settings-service.test.ts
git commit -m "feat: add app-settings service (general settings + public base URL)"
```

---

### Task 10: General settings API route

**Files:**
- Create: `apps/web/src/app/api/settings/general/route.ts`
- Modify: `apps/web/src/lib/api-paths.ts`

- [ ] **Step 1: Add the api-path.** In `apps/web/src/lib/api-paths.ts`, add to the `apiPaths` object:

```ts
  settingsGeneral: "/api/settings/general",
```

- [ ] **Step 2: Implement the route** (`route.ts`):

```ts
import { NextResponse } from "next/server";
import { updateGeneralSettingsSchema } from "@lumio/shared";
import { withAuth } from "@/lib/server/with-auth";
import { parseJson, errorJson } from "@/lib/server/route-helpers";
import { getGeneralSettings, updateGeneralSettings, InvalidBaseUrlError } from "@/lib/server/app-settings-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async () => {
  return NextResponse.json(await getGeneralSettings());
});

export const PUT = withAuth(async (request) => {
  const parsed = await parseJson(request, updateGeneralSettingsSchema);
  if ("response" in parsed) return parsed.response;
  try {
    return NextResponse.json(await updateGeneralSettings(parsed.data));
  } catch (err) {
    if (err instanceof InvalidBaseUrlError) return errorJson(err.message, 400);
    throw err;
  }
});
```

- [ ] **Step 3: Verify build/lint** (no unit test — route is thin; covered manually + by service tests):

Run: `pnpm --filter @lumio/web lint`
Expected: no errors for the new file.

- [ ] **Step 4: Manual verification** — start the dev server (`pnpm dev`), log in, then in the browser console:

```js
await fetch("/api/settings/general").then(r => r.json()); // → { publicBaseUrl: null }
await fetch("/api/settings/general", {method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({publicBaseUrl:"https://x.test/"})}).then(r => r.json()); // → { publicBaseUrl: "https://x.test" }
await fetch("/api/settings/general", {method:"PUT",headers:{"content-type":"application/json"},body:JSON.stringify({publicBaseUrl:"bad"})}).then(r => r.status); // → 400
```
Expected: the three results above. Then reset it back to `""` (clear) so later tasks start clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/settings/general/route.ts apps/web/src/lib/api-paths.ts
git commit -m "feat: add GET/PUT /api/settings/general"
```

---

### Task 11: Settings → General page

**Files:**
- Create: `apps/web/src/app/(app)/settings/general/page.tsx`
- Create: `apps/web/src/app/(app)/settings/general/general-settings-form.tsx`
- Modify: `apps/web/src/components/settings-sidebar.tsx`

- [ ] **Step 1: Add the sidebar nav item.** In `settings-sidebar.tsx`, import `Settings2` and add an `ITEMS` entry (place it first, before Account):

```tsx
import { ArrowLeft, FileClock, GalleryHorizontalEnd, Settings2, ToggleRight, User, Users } from "lucide-react";
```

```tsx
const ITEMS: NavItem[] = [
  { href: "/settings/general", label: "General", icon: Settings2, match: ["/settings/general"] },
  { href: "/settings/account", label: "Account", icon: User, match: ["/settings/account"] },
  // ...existing entries unchanged
];
```

- [ ] **Step 2: Create the server page** (`page.tsx`):

```tsx
import type { Metadata } from "next";
import { getGeneralSettings } from "@/lib/server/app-settings-service";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { GeneralSettingsForm } from "./general-settings-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "General" };

export default async function GeneralSettingsPage() {
  const settings = await getGeneralSettings();
  return (
    <main className="mx-auto max-w-3xl space-y-8 p-4 py-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold tracking-tight">General</h1>
        <p className="text-sm text-muted-foreground">App-wide settings.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Public base URL</CardTitle>
          <CardDescription>
            The address this app is reachable at from the public internet (e.g.
            https://photos.example.com). Required before you can create share links.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <GeneralSettingsForm initial={settings.publicBaseUrl} />
        </CardContent>
      </Card>
    </main>
  );
}
```

- [ ] **Step 3: Create the client form** (`general-settings-form.tsx`):

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { apiPaths } from "@/lib/api-paths";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function GeneralSettingsForm({ initial }: { initial: string | null }) {
  const router = useRouter();
  const [value, setValue] = useState(initial ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const res = await fetch(apiPaths.settingsGeneral, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ publicBaseUrl: value.trim() }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(typeof data?.error === "string" ? data.error : "Failed to save");
        return;
      }
      const data = (await res.json()) as { publicBaseUrl: string | null };
      setValue(data.publicBaseUrl ?? "");
      toast.success("Saved");
      router.refresh();
    } catch {
      setError("Failed to save");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="public-base-url">URL</Label>
        <Input
          id="public-base-url"
          placeholder="https://photos.example.com"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
```

- [ ] **Step 4: Lint + manual verify**

Run: `pnpm --filter @lumio/web lint`
Then in the browser: navigate to `/settings/general`, confirm the "General" rail item appears and is active, enter `https://photos.example.com/`, Save → toast "Saved", reload → field shows `https://photos.example.com` (trailing slash trimmed). Enter `bad` → Save → inline error.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/\(app\)/settings/general apps/web/src/components/settings-sidebar.tsx
git commit -m "feat: add Settings → General page with Public base URL"
```

---

# Phase 5 — Share-links service & authed API

### Task 12: Share-links service (create/list/delete/resolve/photos)

**Files:**
- Create: `apps/web/src/lib/server/share-links-service.ts`
- Test: `apps/web/src/lib/server/share-links-service.test.ts`

This is the core. It composes the db helpers (Task 4), crypto (Task 8), `listPhotosForWhere` (photos-service), and `LIVE_PHOTO`.

- [ ] **Step 1: Write the failing test** — covers create (token + hash + catalog-owned filtering + URL), summary shaping, and the not-found delete error:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  createShareLink,
  deleteShareLinkChecked,
  ShareLinkNotFoundError,
} from "./share-links-service.js";

const CAT = "cat1";
const BASE = "https://x.test";

function fakeDb(over: Record<string, unknown> = {}) {
  return {
    shareLink: {
      create: vi.fn().mockResolvedValue({
        id: "s1",
        token: "TOKEN",
        catalogId: CAT,
        title: "T",
        passwordHash: null,
        expiresAt: null,
        createdAt: new Date("2026-06-01T00:00:00Z"),
      }),
      deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    shareLinkPhoto: { findUnique: vi.fn() },
    photo: {
      findMany: vi.fn().mockResolvedValue([{ id: "p1" }, { id: "p2" }]),
      count: vi.fn().mockResolvedValue(2),
      findFirst: vi.fn().mockResolvedValue({ id: "p1" }),
    },
    ...over,
  };
}

describe("createShareLink", () => {
  it("generates a token, links only catalog-owned photos, and returns an absolute URL", async () => {
    const db = fakeDb();
    const deps = {
      generateToken: () => "TOKEN",
      hashPassword: vi.fn(),
    };
    const dto = await createShareLink(
      CAT,
      { photoIds: ["p1", "p2", "pX"], title: "T" },
      { baseUrl: BASE },
      db as never,
      deps as never,
    );
    expect(dto.token).toBe("TOKEN");
    expect(dto.url).toBe("https://x.test/share/TOKEN");
    expect(dto.hasPassword).toBe(false);
    // only owned photos (p1,p2) get membership rows
    const createArg = (db.shareLink.create as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(createArg.data.photos.create).toEqual([{ photoId: "p1" }, { photoId: "p2" }]);
    expect(deps.hashPassword).not.toHaveBeenCalled();
  });

  it("hashes a password when provided", async () => {
    const db = fakeDb({
      shareLink: {
        create: vi.fn().mockResolvedValue({
          id: "s1", token: "TOKEN", catalogId: CAT, title: null,
          passwordHash: "h", expiresAt: null, createdAt: new Date(),
        }),
        deleteMany: vi.fn(),
      },
    });
    const deps = { generateToken: () => "TOKEN", hashPassword: vi.fn().mockResolvedValue("h") };
    const dto = await createShareLink(CAT, { photoIds: ["p1"], password: "pw" }, { baseUrl: BASE }, db as never, deps as never);
    expect(deps.hashPassword).toHaveBeenCalledWith("pw");
    expect(dto.hasPassword).toBe(true);
  });
});

describe("deleteShareLinkChecked", () => {
  it("throws ShareLinkNotFoundError when nothing was deleted", async () => {
    const db = fakeDb({ shareLink: { deleteMany: vi.fn().mockResolvedValue({ count: 0 }) } });
    await expect(deleteShareLinkChecked(CAT, "missing", db as never)).rejects.toBeInstanceOf(
      ShareLinkNotFoundError,
    );
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @lumio/web exec vitest run src/lib/server/share-links-service.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** (`share-links-service.ts`):

```ts
import {
  type Prisma,
  type PrismaClient,
  type ShareLink,
  prisma,
  listShareLinksForCatalog,
  deleteShareLink as deleteShareLinkRow,
  findShareLinkByToken,
  shareLinkPhotoExists as shareLinkPhotoExistsRow,
  shareLinkPhotoWhere,
} from "@lumio/db";
import type { PhotosPage, PhotosQuery, ShareLinkSummaryDTO } from "@lumio/shared";
import { listPhotosForWhere } from "@/lib/server/photos-service";
import { LIVE_PHOTO } from "@/lib/server/photo-filters";
import { PHOTO_ORDER } from "@/lib/photo-order";
import { generateShareToken, hashPassword as hashPasswordImpl } from "@/lib/server/share-crypto";

type Db = Pick<PrismaClient, "shareLink" | "shareLinkPhoto" | "photo">;

export class ShareLinkNotFoundError extends Error {
  constructor(message = "Share link not found") {
    super(message);
  }
}

interface CreateDeps {
  generateToken: () => string;
  hashPassword: (pw: string) => Promise<string>;
}
const DEFAULT_DEPS: CreateDeps = { generateToken: generateShareToken, hashPassword: hashPasswordImpl };

function isExpired(expiresAt: Date | null, now: Date): boolean {
  return expiresAt !== null && expiresAt.getTime() <= now.getTime();
}

function buildUrl(baseUrl: string, token: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/share/${token}`;
}

/** Create a link over the catalog-owned, live subset of `photoIds`. */
export async function createShareLink(
  catalogId: string,
  input: { photoIds: string[]; title?: string; password?: string; expiresAt?: string },
  opts: { baseUrl: string },
  db: Db = prisma,
  deps: CreateDeps = DEFAULT_DEPS,
): Promise<ShareLinkSummaryDTO> {
  // Only link photos that belong to this catalog and are live (never another
  // catalog's ids, never trashed photos).
  const owned = await db.photo.findMany({
    where: { catalogId, ...LIVE_PHOTO, id: { in: input.photoIds } },
    select: { id: true },
  });
  const passwordHash = input.password ? await deps.hashPassword(input.password) : null;
  const row = await db.shareLink.create({
    data: {
      catalogId,
      token: deps.generateToken(),
      title: input.title ?? null,
      passwordHash,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      photos: { create: owned.map(({ id }) => ({ photoId: id })) },
    },
  });
  return summarize(catalogId, row, opts.baseUrl, owned.length, owned[0]?.id ?? null);
}

function summarize(
  _catalogId: string,
  row: ShareLink,
  baseUrl: string,
  photoCount: number,
  coverPhotoId: string | null,
  now: Date = new Date(),
): ShareLinkSummaryDTO {
  return {
    id: row.id,
    token: row.token,
    url: buildUrl(baseUrl, row.token),
    title: row.title,
    hasPassword: row.passwordHash !== null,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    isExpired: isExpired(row.expiresAt, now),
    photoCount,
    coverPhotoId,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listShareLinks(
  catalogId: string,
  baseUrl: string,
  db: Db = prisma,
): Promise<ShareLinkSummaryDTO[]> {
  const rows = await listShareLinksForCatalog(catalogId, db);
  const now = new Date();
  return Promise.all(
    rows.map(async (row) => {
      const where: Prisma.PhotoWhereInput = { catalogId, ...LIVE_PHOTO, ...shareLinkPhotoWhere(row.id) };
      const [photoCount, cover] = await Promise.all([
        db.photo.count({ where }),
        db.photo.findFirst({ where, orderBy: PHOTO_ORDER, select: { id: true } }),
      ]);
      return summarize(catalogId, row, baseUrl, photoCount, cover?.id ?? null, now);
    }),
  );
}

export async function deleteShareLinkChecked(catalogId: string, id: string, db: Db = prisma): Promise<void> {
  const count = await deleteShareLinkRow(catalogId, id, db);
  if (count === 0) throw new ShareLinkNotFoundError();
}

/** Resolve a token to its row (or null). No expiry/feature checks — see withShare. */
export function resolveShareLink(token: string, db: Db = prisma): Promise<ShareLink | null> {
  return findShareLinkByToken(token, db);
}

export { isExpired };

/** A page of a link's live member photos, in canonical order. */
export function listShareLinkPhotos(
  catalogId: string,
  shareLinkId: string,
  params: PhotosQuery,
  db: Db = prisma,
): Promise<PhotosPage> {
  const { limit, offset, sort } = params;
  return listPhotosForWhere(catalogId, shareLinkPhotoWhere(shareLinkId), { limit, offset, sort }, db);
}

/** Minimal {id,path,edits,wb} for every live member photo, for zipping (edited variant). */
export function listShareLinkPhotosForDownload(
  catalogId: string,
  shareLinkId: string,
  db: Db = prisma,
): Promise<{ id: string; path: string; edits: unknown; asShotTempK: number | null; asShotTint: number | null }[]> {
  return db.photo.findMany({
    where: { catalogId, ...LIVE_PHOTO, ...shareLinkPhotoWhere(shareLinkId) },
    orderBy: PHOTO_ORDER,
    select: { id: true, path: true, edits: true, asShotTempK: true, asShotTint: true },
  });
}

export function shareLinkPhotoExists(shareLinkId: string, photoId: string, db: Db = prisma): Promise<boolean> {
  return shareLinkPhotoExistsRow(shareLinkId, photoId, db);
}
```

> `LIVE_PHOTO` is in `apps/web/src/lib/server/photo-filters.ts`; `PHOTO_ORDER` in `apps/web/src/lib/photo-order.ts` (both already used by albums-service — copy those import paths exactly).

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @lumio/web exec vitest run src/lib/server/share-links-service.test.ts`
Expected: PASS.

- [ ] **Step 5: Register the domain error.** In `apps/web/src/lib/server/route-helpers.ts`, import and add to the `ERROR_STATUS` table:

```ts
import { ShareLinkNotFoundError } from "@/lib/server/share-links-service";
```

Add the tuple `[ShareLinkNotFoundError, 404],` to the `ERROR_STATUS` array.

- [ ] **Step 6: Lint**

Run: `pnpm --filter @lumio/web lint`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/server/share-links-service.ts apps/web/src/lib/server/share-links-service.test.ts apps/web/src/lib/server/route-helpers.ts
git commit -m "feat: add share-links service"
```

---

### Task 13: Authed share-links API (create + list + revoke)

**Files:**
- Create: `apps/web/src/app/api/c/[catalog]/share-links/route.ts`
- Create: `apps/web/src/app/api/c/[catalog]/share-links/[id]/route.ts`

- [ ] **Step 1: Implement the collection route** (`share-links/route.ts`):

```ts
import { NextResponse } from "next/server";
import { createShareLinkSchema } from "@lumio/shared";
import { withCatalog } from "@/lib/server/with-catalog";
import { parseJson, errorJson, mapServiceError } from "@/lib/server/route-helpers";
import { getPublicBaseUrl } from "@/lib/server/app-settings-service";
import { createShareLink, listShareLinks } from "@/lib/server/share-links-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withCatalog(async (_request, _context, { catalog }) => {
  const baseUrl = (await getPublicBaseUrl()) ?? "";
  const items = await listShareLinks(catalog.id, baseUrl);
  return NextResponse.json({ items });
});

export const POST = withCatalog(async (request, _context, { catalog }) => {
  const parsed = await parseJson(request, createShareLinkSchema);
  if ("response" in parsed) return parsed.response;
  const baseUrl = await getPublicBaseUrl();
  if (!baseUrl) {
    return errorJson("Set your Public base URL in Settings → General first", 400, { code: "no_base_url" });
  }
  try {
    const link = await createShareLink(catalog.id, parsed.data, { baseUrl });
    return NextResponse.json(link, { status: 201 });
  } catch (err) {
    const mapped = mapServiceError(err);
    if (mapped) return mapped;
    throw err;
  }
});
```

- [ ] **Step 2: Implement the item route** (`share-links/[id]/route.ts`):

```ts
import { NextResponse } from "next/server";
import { withCatalog } from "@/lib/server/with-catalog";
import { mapServiceError } from "@/lib/server/route-helpers";
import { deleteShareLinkChecked } from "@/lib/server/share-links-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const DELETE = withCatalog<{ id: string }>(async (_request, context, { catalog }) => {
  const { id } = await context.params;
  try {
    await deleteShareLinkChecked(catalog.id, id);
  } catch (err) {
    const mapped = mapServiceError(err);
    if (mapped) return mapped;
    throw err;
  }
  return new NextResponse(null, { status: 204 });
});
```

- [ ] **Step 3: Lint + manual verify.** Set a base URL in `/settings/general` first. Then in the browser console (replace `<slug>` with a real catalog slug and `<id1>` with a real photo id from the photos grid):

```js
const r = await fetch("/api/c/<slug>/share-links", {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({photoIds:["<id1>"],title:"Test"})}).then(r=>r.json());
r; // → { id, token, url: "https://.../share/<token>", title:"Test", hasPassword:false, photoCount:1, ... }
await fetch("/api/c/<slug>/share-links").then(r=>r.json()); // → { items: [ ... that link ... ] }
await fetch(`/api/c/<slug>/share-links/${r.id}`, {method:"DELETE"}).then(r=>r.status); // → 204
```
Also verify: clearing the base URL then POSTing returns `400` with `{ code: "no_base_url" }`.

Run: `pnpm --filter @lumio/web lint`

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/api/c/[catalog]/share-links"
git commit -m "feat: add authed share-links API (create, list, revoke)"
```

---

# Phase 6 — Public access (`withShare` + public routes)

### Task 14: `withShare` wrapper (+ pure access logic)

**Files:**
- Create: `apps/web/src/lib/server/share-access.ts` (pure — unit-tested)
- Test: `apps/web/src/lib/server/share-access.test.ts`
- Create: `apps/web/src/lib/server/with-share.ts` (server-only — not directly unit-tested)

`withShare` enforces feature → expiry → password and exposes `{ shareLink, catalog }` to handlers. The **pure** decision (`evaluateShareAccess`) lives in `share-access.ts` so it can be unit-tested without importing `next/headers` or `server-only` (both throw under vitest). `with-share.ts` keeps the Next/cookie wiring and is verified via the integration steps in later tasks.

- [ ] **Step 1: Write the failing test** (`share-access.test.ts`):

```ts
import { describe, expect, it } from "vitest";
import { evaluateShareAccess } from "./share-access.js";

const link = (over: Partial<{ passwordHash: string | null; expiresAt: Date | null }> = {}) => ({
  passwordHash: null as string | null,
  expiresAt: null as Date | null,
  ...over,
});
const NOW = new Date("2026-06-25T00:00:00Z");

describe("evaluateShareAccess", () => {
  it("denies when the feature is disabled", () => {
    expect(evaluateShareAccess({ link: link(), featureEnabled: false, unlocked: false, now: NOW }))
      .toEqual({ ok: false, reason: "unavailable" });
  });
  it("denies when expired", () => {
    const r = evaluateShareAccess({ link: link({ expiresAt: new Date("2026-06-24T00:00:00Z") }), featureEnabled: true, unlocked: false, now: NOW });
    expect(r).toEqual({ ok: false, reason: "unavailable" });
  });
  it("requires a password when one is set and not unlocked", () => {
    const r = evaluateShareAccess({ link: link({ passwordHash: "h" }), featureEnabled: true, unlocked: false, now: NOW });
    expect(r).toEqual({ ok: false, reason: "password" });
  });
  it("allows when unlocked", () => {
    const r = evaluateShareAccess({ link: link({ passwordHash: "h" }), featureEnabled: true, unlocked: true, now: NOW });
    expect(r).toEqual({ ok: true });
  });
  it("allows a public (no-password, unexpired, enabled) link", () => {
    expect(evaluateShareAccess({ link: link(), featureEnabled: true, unlocked: false, now: NOW })).toEqual({ ok: true });
  });
});
```

- [ ] **Step 2: Run to confirm failure**

Run: `pnpm --filter @lumio/web exec vitest run src/lib/server/share-access.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the pure module** (`share-access.ts`) — no `server-only`, no `next/headers`, no `@lumio/db`:

```ts
import { isExpired } from "@/lib/server/share-links-service";

/** Pure access decision for a share link. */
export function evaluateShareAccess(args: {
  link: { passwordHash: string | null; expiresAt: Date | null };
  featureEnabled: boolean;
  unlocked: boolean;
  now: Date;
}): { ok: true } | { ok: false; reason: "unavailable" | "password" } {
  if (!args.featureEnabled) return { ok: false, reason: "unavailable" };
  if (isExpired(args.link.expiresAt, args.now)) return { ok: false, reason: "unavailable" };
  if (args.link.passwordHash && !args.unlocked) return { ok: false, reason: "password" };
  return { ok: true };
}
```

> This imports `isExpired` from `share-links-service` (Task 12), which is vitest-safe (no `server-only`/`next/headers` in its import graph). It does NOT import `with-share.ts`, so the test never pulls `next/headers`.

- [ ] **Step 4: Implement the wrapper** (`with-share.ts`) — this one keeps `server-only` + `next/headers`:

```ts
import "server-only";
import { cookies } from "next/headers";
import { type Catalog, type ShareLink, getCatalogById, isFeatureEnabled } from "@lumio/db";
import { FeatureKey } from "@lumio/shared";
import { resolveShareLink } from "@/lib/server/share-links-service";
import { evaluateShareAccess } from "@/lib/server/share-access";
import { verifyUnlock } from "@/lib/server/share-crypto";

export const SHARE_UNLOCK_PREFIX = "lumio.share.";
export function unlockCookieName(token: string): string {
  return `${SHARE_UNLOCK_PREFIX}${token}`;
}

export type ShareExtras = { shareLink: ShareLink; catalog: Catalog };
export type ShareContext<P = Record<string, string>> = { params: Promise<P & { token: string }> };

type ShareHandler<P> = (
  request: Request,
  context: ShareContext<P>,
  extras: ShareExtras,
) => Promise<Response> | Response;

/**
 * Wrap a public route handler so it only runs for a valid, enabled, unexpired,
 * (and if needed) unlocked share token. Mirrors withCatalog's shape, but uses
 * the share token instead of a session.
 */
export function withShare<P = Record<string, string>>(handler: ShareHandler<P>) {
  return async (request: Request, context: ShareContext<P>): Promise<Response> => {
    const { token } = await context.params;
    const shareLink = await resolveShareLink(token);
    if (!shareLink) return new Response("Not found", { status: 404 });

    const catalog = await getCatalogById(shareLink.catalogId);
    if (!catalog) return new Response("Not found", { status: 404 });

    const featureEnabled = await isFeatureEnabled(catalog.id, FeatureKey.Sharing);
    const cookieVal = (await cookies()).get(unlockCookieName(token))?.value ?? "";
    const unlocked = verifyUnlock(token, cookieVal);

    const access = evaluateShareAccess({ link: shareLink, featureEnabled, unlocked, now: new Date() });
    if (!access.ok) {
      return new Response(access.reason === "password" ? "Password required" : "Not found", {
        status: access.reason === "password" ? 401 : 404,
      });
    }
    return handler(request, context, { shareLink, catalog });
  };
}
```

- [ ] **Step 5: Run tests + lint**

Run: `pnpm --filter @lumio/web exec vitest run src/lib/server/share-access.test.ts && pnpm --filter @lumio/web lint`
Expected: PASS + clean.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/server/share-access.ts apps/web/src/lib/server/share-access.test.ts apps/web/src/lib/server/with-share.ts
git commit -m "feat: add withShare wrapper + pure share-access logic"
```

---

### Task 15: Public photos list + image renditions

**Files:**
- Create: `apps/web/src/app/api/share/[token]/photos/route.ts`
- Create: `apps/web/src/app/api/share/[token]/photos/[id]/thumbnail/route.ts`
- Create: `apps/web/src/app/api/share/[token]/photos/[id]/display/route.ts`

- [ ] **Step 1: Implement the list route** (`photos/route.ts`):

```ts
import { NextResponse } from "next/server";
import { photosQuerySchema } from "@lumio/shared";
import { withShare } from "@/lib/server/with-share";
import { parseQuery } from "@/lib/server/route-helpers";
import { listShareLinkPhotos } from "@/lib/server/share-links-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withShare(async (request, _context, { shareLink, catalog }) => {
  const parsed = parseQuery(request, photosQuerySchema);
  if ("response" in parsed) return parsed.response;
  const page = await listShareLinkPhotos(catalog.id, shareLink.id, parsed.data);
  return NextResponse.json(page);
});
```

- [ ] **Step 2: Implement the thumbnail route** (`photos/[id]/thumbnail/route.ts`). Note the private cache (protected renditions must not be cached by shared proxies) and the membership check:

```ts
import { readFile } from "node:fs/promises";
import { thumbnailPath } from "@/lib/server/server-paths";
import { withShare } from "@/lib/server/with-share";
import { binaryResponse, errorJson } from "@/lib/server/route-helpers";
import { shareLinkPhotoExists } from "@/lib/server/share-links-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withShare<{ id: string }>(async (_request, context, { shareLink, catalog }) => {
  const { id } = await context.params;
  if (!(await shareLinkPhotoExists(shareLink.id, id))) return errorJson("Not found", 404);
  try {
    return binaryResponse(await readFile(thumbnailPath(catalog.id, id)), {
      contentType: "image/webp",
      cacheControl: "private, max-age=300",
    });
  } catch {
    return errorJson("Thumbnail not found", 404);
  }
});
```

- [ ] **Step 3: Implement the display route** (`photos/[id]/display/route.ts`):

```ts
import { readFile } from "node:fs/promises";
import { displayPath, editedDisplayPath } from "@/lib/server/server-paths";
import { withShare } from "@/lib/server/with-share";
import { binaryResponse, errorJson } from "@/lib/server/route-helpers";
import { shareLinkPhotoExists } from "@/lib/server/share-links-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withShare<{ id: string }>(async (_request, context, { shareLink, catalog }) => {
  const { id } = await context.params;
  if (!(await shareLinkPhotoExists(shareLink.id, id))) return errorJson("Not found", 404);
  try {
    try {
      return binaryResponse(await readFile(editedDisplayPath(catalog.id, id)), {
        contentType: "image/webp",
        cacheControl: "private, max-age=300",
      });
    } catch {
      // no edited variant → fall through to the base
    }
    return binaryResponse(await readFile(displayPath(catalog.id, id)), {
      contentType: "image/webp",
      cacheControl: "private, max-age=300",
    });
  } catch {
    return errorJson("Display rendition not found", 404);
  }
});
```

- [ ] **Step 4: Lint**

Run: `pnpm --filter @lumio/web lint`
Expected: clean. (Full manual verification happens after the gallery UI lands — Task 19.)

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/api/share/[token]/photos"
git commit -m "feat: add public share photos list + thumbnail + display routes"
```

---

### Task 16: Public downloads (single baked JPEG + zip-all)

**Files:**
- Create: `apps/web/src/app/api/share/[token]/photos/[id]/download/route.ts`
- Create: `apps/web/src/app/api/share/[token]/download-all/route.ts`

- [ ] **Step 1: Implement the single-photo baked download** (`photos/[id]/download/route.ts`) — mirrors the authed `edited` route, but via `withShare` + membership:

```ts
import { NextResponse } from "next/server";
import { decodeToSharpInput, encodeEditedJpeg } from "@lumio/ingest";
import { wbBaselineOf } from "@lumio/shared";
import { getPhoto } from "@/lib/server/photos-service";
import { originalPath } from "@/lib/server/server-paths";
import { attachmentDisposition, jpegName } from "@/lib/server/download-archive";
import { withShare } from "@/lib/server/with-share";
import { shareLinkPhotoExists } from "@/lib/server/share-links-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withShare<{ id: string }>(async (_request, context, { shareLink, catalog }) => {
  const { id } = await context.params;
  if (!(await shareLinkPhotoExists(shareLink.id, id))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  const photo = await getPhoto(catalog.id, id);
  if (!photo) return NextResponse.json({ error: "Photo not found" }, { status: 404 });

  const decoded = await decodeToSharpInput(originalPath(catalog, photo.path));
  try {
    const jpeg = await encodeEditedJpeg(decoded.input, photo.edits, wbBaselineOf(photo));
    return new NextResponse(new Uint8Array(jpeg), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "private, max-age=0, must-revalidate",
        "Content-Disposition": attachmentDisposition(jpegName(photo.path)),
      },
    });
  } catch {
    return NextResponse.json({ error: "Original not found" }, { status: 404 });
  } finally {
    await decoded.cleanup();
  }
});
```

- [ ] **Step 2: Implement the zip-all route** (`download-all/route.ts`) — reuses `streamPhotosZip` with the `"edited"` variant:

```ts
import { withShare } from "@/lib/server/with-share";
import { originalPath } from "@/lib/server/server-paths";
import { sanitizeZipName, streamPhotosZip } from "@/lib/server/download-archive";
import { listShareLinkPhotosForDownload } from "@/lib/server/share-links-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withShare(async (_request, _context, { shareLink, catalog }) => {
  const photos = await listShareLinkPhotosForDownload(catalog.id, shareLink.id);
  const name = `${sanitizeZipName(shareLink.title ?? "shared-photos")}.zip`;
  return streamPhotosZip(photos, name, "edited", (relPath) => originalPath(catalog, relPath));
});
```

- [ ] **Step 3: Lint**

Run: `pnpm --filter @lumio/web lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/api/share/[token]/photos/[id]/download" "apps/web/src/app/api/share/[token]/download-all"
git commit -m "feat: add public share downloads (baked JPEG + edited zip)"
```

---

### Task 17: Public unlock route (password → signed cookie)

**Files:**
- Create: `apps/web/src/app/api/share/[token]/unlock/route.ts`

This route is NOT wrapped in `withShare` (the caller has no cookie yet). It validates the password directly against the link and sets the unlock cookie.

- [ ] **Step 1: Implement** (`unlock/route.ts`):

```ts
import { NextResponse } from "next/server";
import { shareUnlockSchema, FeatureKey } from "@lumio/shared";
import { isFeatureEnabled, getCatalogById } from "@lumio/db";
import { parseJson, errorJson } from "@/lib/server/route-helpers";
import { resolveShareLink, isExpired } from "@/lib/server/share-links-service";
import { verifyPassword, signUnlock } from "@/lib/server/share-crypto";
import { unlockCookieName } from "@/lib/server/with-share";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const parsed = await parseJson(request, shareUnlockSchema);
  if ("response" in parsed) return parsed.response;

  const link = await resolveShareLink(token);
  if (!link || isExpired(link.expiresAt, new Date()) || !link.passwordHash) {
    return errorJson("Not found", 404);
  }
  const catalog = await getCatalogById(link.catalogId);
  if (!catalog || !(await isFeatureEnabled(catalog.id, FeatureKey.Sharing))) {
    return errorJson("Not found", 404);
  }
  if (!(await verifyPassword(parsed.data.password, link.passwordHash))) {
    return errorJson("Incorrect password", 401);
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(unlockCookieName(token), signUnlock(token), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" || process.env.USE_SECURE_COOKIES === "true",
    path: "/",
    maxAge: 60 * 60 * 12, // 12 hours
  });
  return res;
}
```

- [ ] **Step 2: Lint**

Run: `pnpm --filter @lumio/web lint`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/api/share/[token]/unlock"
git commit -m "feat: add public share unlock route (sets signed cookie)"
```

---

# Phase 7 — Public gallery UI

### Task 18: Public URL helpers + unavailable + password gate

**Files:**
- Create: `apps/web/src/lib/share-url.ts`
- Create: `apps/web/src/app/share/[token]/share-unavailable.tsx`
- Create: `apps/web/src/app/share/[token]/share-password-gate.tsx`

- [ ] **Step 1: Create the URL helpers** (`share-url.ts`) — plain client-safe builders (no server-only):

```ts
/** Public, token-scoped rendition URLs for the share gallery. */
export function shareThumbUrl(token: string, id: string, version: number): string {
  return `/api/share/${encodeURIComponent(token)}/photos/${id}/thumbnail?v=${version}`;
}
export function shareDisplayUrl(token: string, id: string, version: number): string {
  return `/api/share/${encodeURIComponent(token)}/photos/${id}/display?v=${version}`;
}
export function shareDownloadUrl(token: string, id: string): string {
  return `/api/share/${encodeURIComponent(token)}/photos/${id}/download`;
}
export function shareDownloadAllUrl(token: string): string {
  return `/api/share/${encodeURIComponent(token)}/download-all`;
}
export function sharePhotosEndpoint(token: string): string {
  return `/api/share/${encodeURIComponent(token)}/photos`;
}
```

- [ ] **Step 2: Create the unavailable screen** (`share-unavailable.tsx`) — a plain server component:

```tsx
import { ImageOff } from "lucide-react";

export function ShareUnavailable() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
      <ImageOff className="size-10 text-muted-foreground/60" aria-hidden />
      <h1 className="text-xl font-semibold tracking-tight">This link is no longer available</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        The share link may have been revoked, expired, or disabled.
      </p>
    </main>
  );
}
```

- [ ] **Step 3: Create the password gate** (`share-password-gate.tsx`) — client component that unlocks then reloads:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function SharePasswordGate({ token, title }: { token: string; title: string | null }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pending || !password) return;
    setPending(true);
    setError(false);
    try {
      const res = await fetch(`/api/share/${encodeURIComponent(token)}/unlock`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        setError(true);
        return;
      }
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6">
      <form onSubmit={(e) => void handleSubmit(e)} className="w-full max-w-sm space-y-4 text-center">
        <Lock className="mx-auto size-8 text-muted-foreground/70" aria-hidden />
        <h1 className="text-xl font-semibold tracking-tight">{title ?? "Protected gallery"}</h1>
        <p className="text-sm text-muted-foreground">Enter the password to view these photos.</p>
        <div className="space-y-1.5 text-left">
          <Label htmlFor="share-password">Password</Label>
          <Input
            id="share-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            Incorrect password.
          </p>
        )}
        <Button type="submit" className="w-full" disabled={pending || !password}>
          {pending ? "Unlocking…" : "View gallery"}
        </Button>
      </form>
    </main>
  );
}
```

- [ ] **Step 4: Lint**

Run: `pnpm --filter @lumio/web lint`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/share-url.ts "apps/web/src/app/share/[token]/share-unavailable.tsx" "apps/web/src/app/share/[token]/share-password-gate.tsx"
git commit -m "feat: add public share URL helpers, unavailable + password-gate screens"
```

---

### Task 19: Public gallery page + grid/viewer

**Files:**
- Create: `apps/web/src/app/share/[token]/share-gallery.tsx`
- Create: `apps/web/src/app/share/[token]/page.tsx`

A standalone, dependency-light gallery (the authed `PhotoGrid` is coupled to `useCatalog()` + auth-gated image routes, so we don't reuse it). It pages the public photos endpoint, renders a responsive grid with thumbhash placeholders, and a simple full-screen viewer with a download button.

- [ ] **Step 1: Create the gallery client component** (`share-gallery.tsx`):

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, X, ChevronLeft, ChevronRight } from "lucide-react";
import type { PhotoDTO, PhotosPage } from "@lumio/shared";
import { thumbhashDataUrl } from "@/lib/thumbhash-url";
import { renditionVersion } from "@/lib/rendition-url";
import { Button } from "@/components/ui/button";
import {
  shareThumbUrl,
  shareDisplayUrl,
  shareDownloadUrl,
  shareDownloadAllUrl,
  sharePhotosEndpoint,
} from "@/lib/share-url";

const PAGE_SIZE = 100;

export function ShareGallery({ token, title }: { token: string; title: string | null }) {
  const [photos, setPhotos] = useState<PhotoDTO[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [viewer, setViewer] = useState<number | null>(null);
  const loadingRef = useRef(false);

  const loadMore = useCallback(async () => {
    if (loadingRef.current) return;
    if (total !== null && photos.length >= total) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const url = `${sharePhotosEndpoint(token)}?limit=${PAGE_SIZE}&offset=${photos.length}`;
      const res = await fetch(url);
      if (!res.ok) return;
      const page = (await res.json()) as PhotosPage;
      setPhotos((prev) => [...prev, ...page.items]);
      setTotal(page.total);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [photos.length, token, total]);

  useEffect(() => {
    void loadMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keyboard nav in the viewer.
  useEffect(() => {
    if (viewer === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setViewer(null);
      if (e.key === "ArrowRight") setViewer((i) => (i === null ? i : Math.min(photos.length - 1, i + 1)));
      if (e.key === "ArrowLeft") setViewer((i) => (i === null ? i : Math.max(0, i - 1)));
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [viewer, photos.length]);

  const hasMore = total === null || photos.length < total;
  const current = viewer !== null ? photos[viewer] : null;

  return (
    <main className="mx-auto max-w-screen-2xl px-4 py-6">
      <header className="mb-6 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{title ?? "Shared photos"}</h1>
          {total !== null && (
            <p className="text-sm text-muted-foreground">
              {total} photo{total === 1 ? "" : "s"}
            </p>
          )}
        </div>
        {total !== null && total > 0 && (
          <Button asChild variant="outline" size="sm">
            <a href={shareDownloadAllUrl(token)} download>
              <Download aria-hidden />
              Download all
            </a>
          </Button>
        )}
      </header>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
        {photos.map((photo, i) => {
          const blur = thumbhashDataUrl(photo.thumbhash);
          return (
            <button
              key={photo.id}
              type="button"
              onClick={() => setViewer(i)}
              className="group relative aspect-square overflow-hidden rounded-lg bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="View photo"
            >
              {blur && (
                <span
                  aria-hidden
                  className="absolute inset-0 bg-cover bg-center"
                  style={{ backgroundImage: `url(${blur})` }}
                />
              )}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={shareThumbUrl(token, photo.id, renditionVersion(photo.updatedAt))}
                alt=""
                loading="lazy"
                className="relative h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
              />
            </button>
          );
        })}
      </div>

      {hasMore && (
        <div className="mt-6 flex justify-center">
          <Button variant="outline" onClick={() => void loadMore()} disabled={loading}>
            {loading ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}

      {current && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90">
          <button
            type="button"
            onClick={() => setViewer(null)}
            className="absolute right-4 top-4 rounded-full p-2 text-white/80 hover:bg-white/10 hover:text-white"
            aria-label="Close"
          >
            <X aria-hidden />
          </button>
          {viewer !== null && viewer > 0 && (
            <button
              type="button"
              onClick={() => setViewer((i) => (i === null ? i : i - 1))}
              className="absolute left-4 rounded-full p-2 text-white/80 hover:bg-white/10 hover:text-white"
              aria-label="Previous"
            >
              <ChevronLeft aria-hidden />
            </button>
          )}
          {viewer !== null && viewer < photos.length - 1 && (
            <button
              type="button"
              onClick={() => setViewer((i) => (i === null ? i : i + 1))}
              className="absolute right-4 top-1/2 rounded-full p-2 text-white/80 hover:bg-white/10 hover:text-white"
              aria-label="Next"
            >
              <ChevronRight aria-hidden />
            </button>
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={shareDisplayUrl(token, current.id, renditionVersion(current.updatedAt))}
            alt=""
            className="max-h-[90dvh] max-w-[92vw] object-contain"
          />
          <a
            href={shareDownloadUrl(token, current.id)}
            download
            className="absolute bottom-4 right-4 flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-sm text-white hover:bg-white/20"
          >
            <Download className="size-4" aria-hidden />
            Download
          </a>
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 2: Create the page** (`page.tsx`) — resolves the link server-side and chooses gate / gallery / unavailable:

```tsx
import { cookies } from "next/headers";
import type { Metadata } from "next";
import { getCatalogById, isFeatureEnabled } from "@lumio/db";
import { FeatureKey } from "@lumio/shared";
import { resolveShareLink, isExpired } from "@/lib/server/share-links-service";
import { verifyUnlock } from "@/lib/server/share-crypto";
import { unlockCookieName } from "@/lib/server/with-share";
import { ShareUnavailable } from "./share-unavailable";
import { SharePasswordGate } from "./share-password-gate";
import { ShareGallery } from "./share-gallery";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Shared photos", robots: { index: false, follow: false } };

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const link = await resolveShareLink(token);
  if (!link || isExpired(link.expiresAt, new Date())) return <ShareUnavailable />;

  const catalog = await getCatalogById(link.catalogId);
  if (!catalog || !(await isFeatureEnabled(catalog.id, FeatureKey.Sharing))) return <ShareUnavailable />;

  if (link.passwordHash) {
    const cookieVal = (await cookies()).get(unlockCookieName(token))?.value ?? "";
    if (!verifyUnlock(token, cookieVal)) return <SharePasswordGate token={token} title={link.title} />;
  }

  return <ShareGallery token={token} title={link.title} />;
}
```

- [ ] **Step 3: Lint**

Run: `pnpm --filter @lumio/web lint`
Expected: clean.

- [ ] **Step 4: End-to-end manual verification.** With dev running, base URL set, and the Sharing feature enabled (toggle it on at `/settings/features`):
  1. Create a link via the console POST from Task 13 (a few photo ids).
  2. Open the returned `url` in a private/incognito window (no session). Expect the gallery to render with thumbnails; clicking a tile opens the viewer; arrows/Esc work; "Download" downloads a JPEG; "Download all" downloads a zip.
  3. Create a password-protected link (`password:"pw"`). Open it → password gate. Wrong password → "Incorrect password." Correct → gallery renders, and a reload stays unlocked.
  4. Revoke a link (DELETE) → its URL shows "This link is no longer available."
  5. Disable the Sharing feature → an existing link's URL shows unavailable. Re-enable to continue.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/share/[token]/share-gallery.tsx" "apps/web/src/app/share/[token]/page.tsx"
git commit -m "feat: add public share gallery page (grid + viewer + downloads)"
```

---

# Phase 8 — Authed UI (Share button + management page)

### Task 20: Share button + create dialog

**Files:**
- Create: `apps/web/src/components/photo-actions/share-link-dialog.tsx`
- Create: `apps/web/src/components/photo-actions/share-button.tsx`

- [ ] **Step 1: Create the dialog** (`share-link-dialog.tsx`) — title + Advanced (expiry + password), creates the link, shows URL + Copy:

```tsx
"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { useCatalog } from "@/components/providers/catalog-context";
import { catalogApiUrl } from "@/lib/catalog-api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

type Expiry = "never" | "7d" | "30d";

function expiryToIso(value: Expiry): string | undefined {
  if (value === "never") return undefined;
  const days = value === "7d" ? 7 : 30;
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

export function ShareLinkDialog({
  ids,
  open,
  onOpenChange,
}: {
  ids: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { slug } = useCatalog();
  const [title, setTitle] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [expiry, setExpiry] = useState<Expiry>("never");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function reset() {
    setTitle("");
    setAdvanced(false);
    setExpiry("never");
    setPassword("");
    setUrl(null);
    setCopied(false);
  }

  async function create() {
    if (pending || ids.length === 0) return;
    setPending(true);
    try {
      const res = await fetch(catalogApiUrl(slug, "/share-links"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          photoIds: ids,
          title: title.trim() || undefined,
          password: password.trim() || undefined,
          expiresAt: expiryToIso(expiry),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        toast.error(data?.error ?? "Failed to create link");
        return;
      }
      const link = (await res.json()) as { url: string };
      setUrl(link.url);
    } catch {
      toast.error("Failed to create link");
    } finally {
      setPending(false);
    }
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard unavailable
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share {ids.length} photo{ids.length === 1 ? "" : "s"}</DialogTitle>
          <DialogDescription>Anyone with the link can view and download these photos.</DialogDescription>
        </DialogHeader>

        {url ? (
          <div className="space-y-3">
            <Label htmlFor="share-url">Link</Label>
            <div className="flex gap-2">
              <Input id="share-url" readOnly value={url} className="font-mono text-xs" />
              <Button type="button" size="icon" variant="outline" onClick={() => void copy()} aria-label="Copy link">
                {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="share-title">Title (optional)</Label>
              <Input
                id="share-title"
                placeholder="e.g. Wedding photos"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            {!advanced ? (
              <button
                type="button"
                onClick={() => setAdvanced(true)}
                className="text-sm text-muted-foreground underline-offset-4 hover:underline"
              >
                Advanced options
              </button>
            ) : (
              <div className="space-y-4 rounded-lg border border-border p-3">
                <div className="space-y-1.5">
                  <Label htmlFor="share-expiry">Expires</Label>
                  <Select value={expiry} onValueChange={(v) => setExpiry(v as Expiry)}>
                    <SelectTrigger id="share-expiry">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="never">Never</SelectItem>
                      <SelectItem value="7d">In 7 days</SelectItem>
                      <SelectItem value="30d">In 30 days</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="share-password">Password (optional)</Label>
                  <Input
                    id="share-password"
                    type="password"
                    placeholder="Leave blank for none"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                  />
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          {url ? (
            <Button type="button" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          ) : (
            <Button type="button" onClick={() => void create()} disabled={pending || ids.length === 0}>
              {pending ? "Creating…" : "Create link"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

> **`@/components/ui/select` does not exist yet** — add it first with `pnpm --filter @lumio/web exec shadcn@latest add select` (do NOT hand-edit `ui/*`; this is a generated shadcn component). Confirm `apps/web/src/components/ui/select.tsx` appears, then `git add` it as part of this task's commit.

- [ ] **Step 2: Create the toolbar button** (`share-button.tsx`):

```tsx
"use client";

import { useState } from "react";
import { Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ShareLinkDialog } from "./share-link-dialog";

export function ShareButton({ ids }: { ids: string[] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="icon-sm"
            disabled={ids.length === 0}
            onClick={() => setOpen(true)}
            aria-label="Share"
          >
            <Share2 aria-hidden />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Share</TooltipContent>
      </Tooltip>
      <ShareLinkDialog ids={ids} open={open} onOpenChange={setOpen} />
    </>
  );
}
```

- [ ] **Step 3: Wire it into the photos view.** In `apps/web/src/app/(app)/c/[catalog]/photos/library-view.tsx`, add the feature gate + selectionActions prop:

```tsx
"use client";

import { photoHref } from "@/lib/photo-href";
import { catalogApiUrl, catalogPath } from "@/lib/catalog-api";
import { useCatalog } from "@/components/providers/catalog-context";
import { useFeature } from "@/components/features/features-provider";
import { FeatureKey } from "@lumio/shared";
import { ShareButton } from "@/components/photo-actions/share-button";
import { PhotoLibraryView } from "@/components/photo-library/photo-library-view";

export function LibraryView() {
  const { slug } = useCatalog();
  const sharingEnabled = useFeature(FeatureKey.Sharing);
  return (
    <PhotoLibraryView
      title="Library"
      calendar={{ facetsEndpoint: catalogApiUrl(slug, "/photos/calendar") }}
      selectionActions={
        sharingEnabled
          ? ({ selectedIds }) => <ShareButton ids={[...selectedIds]} />
          : undefined
      }
      collection={({ sort, month }) => ({
        endpoint: catalogApiUrl(slug, "/photos"),
        params: new URLSearchParams(month ? { sort, month } : { sort }),
        urlForId: (id) => photoHref(slug, id, undefined, sort),
        baseUrl: catalogPath(slug, "/photos"),
        key: `${sort}:${month ?? ""}`,
      })}
    />
  );
}
```

- [ ] **Step 4: Lint + manual verify.** With Sharing enabled and a base URL set: go to `/c/<slug>/photos`, select photos → a Share button appears in the selection toolbar (before the standard actions). Click it → dialog → Create link → URL + Copy works. Toggle Advanced → expiry + password fields appear. Disable the feature → the Share button disappears.

Run: `pnpm --filter @lumio/web lint`

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/photo-actions/share-button.tsx apps/web/src/components/photo-actions/share-link-dialog.tsx "apps/web/src/app/(app)/c/[catalog]/photos/library-view.tsx"
git commit -m "feat: add Share button + create-link dialog to the photos toolbar"
```

---

### Task 21: "Shared" management page + sidebar entry

**Files:**
- Create: `apps/web/src/app/(app)/c/[catalog]/shared/page.tsx`
- Create: `apps/web/src/app/(app)/c/[catalog]/shared/shared-links-list.tsx`
- Modify: `apps/web/src/components/app-sidebar.tsx`

- [ ] **Step 1: Create the server page** (`shared/page.tsx`):

```tsx
import type { Metadata } from "next";
import type { ShareLinkSummaryDTO } from "@lumio/shared";
import { getCatalogForSlug } from "@/lib/server/active-catalog";
import { getPublicBaseUrl } from "@/lib/server/app-settings-service";
import { listShareLinks } from "@/lib/server/share-links-service";
import { SharedLinksList } from "./shared-links-list";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Shared" };

export default async function SharedPage({ params }: { params: Promise<{ catalog: string }> }) {
  const { catalog: slug } = await params;
  const catalog = await getCatalogForSlug(slug);
  const baseUrl = (await getPublicBaseUrl()) ?? "";
  const links: ShareLinkSummaryDTO[] = await listShareLinks(catalog.id, baseUrl);

  return (
    <main className="mx-auto max-w-3xl space-y-8 p-4 py-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Shared links</h1>
        <p className="text-sm text-muted-foreground">
          Public links to selected photos. Anyone with a link can view and download.
        </p>
      </div>
      <SharedLinksList slug={slug} rows={links} />
    </main>
  );
}
```

- [ ] **Step 2: Create the client list** (`shared-links-list.tsx`) — mirrors `CatalogsList` (shadcn `Item`/`ItemGroup`, per-row Copy + Revoke, optimistic remove + `toast`, `useConfirm`):

```tsx
"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Copy, Check, MoreHorizontal, Trash2, Link2, Lock, Clock } from "lucide-react";
import type { ShareLinkSummaryDTO } from "@lumio/shared";
import { catalogApiUrl } from "@/lib/catalog-api";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
} from "@/components/ui/item";
import { useConfirm } from "@/components/confirm-dialog";

export function SharedLinksList({ slug, rows }: { slug: string; rows: ShareLinkSummaryDTO[] }) {
  const router = useRouter();
  const confirm = useConfirm();
  const [items, setItems] = useState(rows);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setItems(rows);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [rows]);

  async function copy(row: ShareLinkSummaryDTO) {
    try {
      await navigator.clipboard.writeText(row.url);
      setCopiedId(row.id);
      setTimeout(() => setCopiedId((id) => (id === row.id ? null : id)), 2000);
    } catch {
      // clipboard unavailable
    }
  }

  async function revoke(row: ShareLinkSummaryDTO) {
    const ok = await confirm({
      title: "Revoke link?",
      description: "The link will stop working immediately. This cannot be undone.",
      confirmLabel: "Revoke",
      destructive: true,
    });
    if (!ok) return;
    const prev = items;
    setItems((list) => list.filter((r) => r.id !== row.id));
    try {
      const res = await fetch(`${catalogApiUrl(slug, "/share-links")}/${row.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(String(res.status));
      router.refresh();
    } catch {
      setItems(prev);
      toast.error("Failed to revoke link");
    }
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-2xl border border-border px-4 py-10 text-center text-sm text-muted-foreground">
        <Link2 className="size-6 opacity-50" aria-hidden />
        No shared links yet. Select photos and choose Share to create one.
      </div>
    );
  }

  return (
    <ItemGroup className="gap-2.5">
      {items.map((row) => (
        <Item key={row.id} variant="outline" className="bg-card">
          <ItemContent className="min-w-0">
            <ItemTitle className="truncate">{row.title ?? "Untitled link"}</ItemTitle>
            <ItemDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>{row.photoCount} photo{row.photoCount === 1 ? "" : "s"}</span>
              {row.hasPassword && (
                <span className="inline-flex items-center gap-1">
                  <Lock className="size-3" aria-hidden /> Password
                </span>
              )}
              {row.expiresAt && (
                <span className="inline-flex items-center gap-1">
                  <Clock className="size-3" aria-hidden />
                  {row.isExpired ? "Expired" : `Expires ${new Date(row.expiresAt).toLocaleDateString()}`}
                </span>
              )}
            </ItemDescription>
          </ItemContent>
          <ItemActions>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => void copy(row)}
              aria-label="Copy link"
            >
              {copiedId === row.id ? <Check aria-hidden /> : <Copy aria-hidden />}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" aria-label="Actions">
                  <MoreHorizontal aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem variant="destructive" onSelect={() => void revoke(row)}>
                  <Trash2 aria-hidden />
                  Revoke
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </ItemActions>
        </Item>
      ))}
    </ItemGroup>
  );
}
```

> `useConfirm()` is exported from `@/components/confirm-dialog` and returns an async `confirm(opts)` resolving to a boolean. Confirmed option keys: `title`, `description`, `confirmLabel`, `destructive` (also `altLabel`/`altDestructive`). The code above uses them correctly.

- [ ] **Step 3: Add the sidebar entry.** In `apps/web/src/components/app-sidebar.tsx`, import `Share2`, and add to `PRIMARY` (after Albums):

```tsx
  { href: "/shared", label: "Shared", icon: Share2, match: ["/shared"], feature: FeatureKey.Sharing },
```

(`Share2` from `lucide-react`; the existing `FeatureGate` wrapping logic already handles `item.feature`.)

- [ ] **Step 4: Lint + manual verify.** With Sharing enabled: the "Shared" item appears in the catalog sidebar. Visit `/c/<slug>/shared` → lists existing links with photo count + badges. Copy button copies the URL (icon flips to a check). Revoke → confirm dialog → row disappears and the public link stops working. Disable the feature → the sidebar item disappears.

Run: `pnpm --filter @lumio/web lint`

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(app)/c/[catalog]/shared" apps/web/src/components/app-sidebar.tsx
git commit -m "feat: add Shared links management page + sidebar entry"
```

---

# Phase 9 — Final verification

### Task 22: Full suite + end-to-end pass

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test`
Expected: all packages pass (`@lumio/shared`, `@lumio/db`, `@lumio/web`). Investigate and fix any failure before continuing.

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm --filter @lumio/shared typecheck && pnpm --filter @lumio/db typecheck && pnpm --filter @lumio/web lint`
Expected: all clean.

- [ ] **Step 3: Production build** (catches App-Router/route typing issues the dev server misses)

Run: `pnpm --filter @lumio/web build`
Expected: build succeeds; the new routes/pages compile.

- [ ] **Step 4: Full manual acceptance** (dev server, Sharing enabled, base URL set):
  1. **Required base URL:** clear the base URL → creating a link surfaces "Set your Public base URL…"; set it → creation works.
  2. **Create + view:** select photos → Share → create → open URL incognito → gallery renders, viewer + per-photo download + download-all all work; downloads carry edits (edit a photo first, then confirm the downloaded JPEG reflects the edit).
  3. **Live references:** edit a shared photo → the shared gallery's display updates; trash a shared photo → it disappears from the gallery.
  4. **Expiry:** create a link expiring in 7 days → visible; (optionally) hand-set `expiresAt` in the past via DB and confirm "no longer available".
  5. **Password:** protected link → gate → wrong/right password → unlock persists across reload.
  6. **Revoke:** revoke → URL becomes unavailable.
  7. **Feature kill-switch:** disable Sharing → Share button + Shared sidebar item vanish; existing public URLs show unavailable. Re-enable.

- [ ] **Step 5: Final commit** (only if Steps 1–3 required fixes; otherwise nothing to commit)

```bash
git add -A
git commit -m "chore: share-links final verification fixes"
```

---

## Notes & deferrals

- **Scope:** Share button is wired into the main `/photos` library view only. Favorites/Search/Album views can adopt the same `selectionActions` render-prop later if desired — not in v1.
- **Cross-catalog links:** out of scope (selection is catalog-scoped).
- **Shared albums (live album → link):** deferred to a future plan; the `ShareLink` model is link-of-photos only.
- **Re-enabling a revoked link:** not supported (revoke = hard delete), per spec.
- **`server-only` guard:** intentionally omitted from `share-crypto.ts` and `share-access.ts` because they have vitest unit tests (the `server-only` package throws under vitest's default resolution). `with-share.ts` keeps it (route-only, never imported by tests).
- **Lint `no-duplicate-imports`:** keep one import statement per module path (already done in the code blocks above).
