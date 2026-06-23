# Refactor B2 — No raw Prisma queries in routes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Remove the raw `prisma.X.Y()` queries from the 4 routes that bypass the service layer (settings `catalog.update`; the thumbnail/display/original image-serving `photo.findFirst`), behind thin `@lumio/db`/service functions and an image-serving response helper, then add a lint rule that bans raw Prisma *queries* in routes going forward.

**Architecture:** Increment B2 of the Phase B/C refactor (spec `docs/superpowers/specs/2026-06-23-refactor-phase-bc-design.md`). **Scope refinement (documented):** the audit counted 12 routes "importing prisma," but 8 of them merely *inject* `prisma` as a `db` argument into a service (`purgeTrash(ids, { db: prisma, … })`, `readWorkerStatus(prisma)`) — that is legitimate dependency injection, NOT a layering violation. Only **4 routes run raw queries** in the route body. B2 fixes those 4 and enforces "no raw Prisma queries in routes" via `no-restricted-syntax` (which still permits `db: prisma` injection), avoiding cosmetic churn of the shared `@lumio/jobs`/service signatures. Behavior-preserving.

**Tech Stack:** Next.js route handlers, Prisma (`@lumio/db`), Zod, Vitest, ESLint flat config. Tests: `pnpm -r test`.

---

## File structure

| File | Change |
| --- | --- |
| `packages/db/src/catalogs.ts` | add `setUploadTemplate(id, uploadTemplate, db?)` |
| `apps/web/src/lib/photos-service.ts` | add `photoExistsInCatalog` + `photoOrTrashedExistsInCatalog` |
| `apps/web/src/lib/route-helpers.ts` | add `binaryResponse(file, opts)` |
| `apps/web/src/app/api/c/[catalog]/settings/route.ts` | use `setUploadTemplate`; drop `prisma` |
| `.../photos/[id]/thumbnail/route.ts`, `.../display/route.ts`, `.../original/route.ts`, `.../edited/route.ts` | use the ownership helper + `binaryResponse`; drop `prisma` + the copy-pasted `webp()` |
| `apps/web/eslint.config.*` | add the `no-restricted-syntax` rule for `app/api/**` |

---

## Task 1: The helper functions

**Files:**
- Modify: `packages/db/src/catalogs.ts`
- Modify: `apps/web/src/lib/photos-service.ts`
- Modify: `apps/web/src/lib/route-helpers.ts`
- Test: `packages/db/src/catalogs.test.ts`, `apps/web/src/lib/photos-service.test.ts`, `apps/web/src/lib/route-helpers.test.ts`

- [ ] **Step 1: Write failing tests**

In `packages/db/src/catalogs.test.ts` (match the file's existing mock-`db` style), add:
```ts
it("setUploadTemplate writes the template and returns the row", async () => {
  const update = vi.fn().mockResolvedValue({ id: "c1", uploadTemplate: "{YYYY}" });
  const db = { catalog: { update } } as never;
  const row = await setUploadTemplate("c1", "{YYYY}", db);
  expect(update).toHaveBeenCalledWith({ where: { id: "c1" }, data: { uploadTemplate: "{YYYY}" } });
  expect(row.uploadTemplate).toBe("{YYYY}");
});
```
In `apps/web/src/lib/photos-service.test.ts` add:
```ts
it("photoExistsInCatalog is true only when the photo is in the catalog", async () => {
  const findFirst = vi.fn().mockResolvedValueOnce({ id: "p1" }).mockResolvedValueOnce(null);
  const db = { photo: { findFirst } } as never;
  expect(await photoExistsInCatalog("c1", "p1", db)).toBe(true);
  expect(await photoExistsInCatalog("c1", "nope", db)).toBe(false);
});
it("photoOrTrashedExistsInCatalog is true if either the live or trashed photo matches", async () => {
  const db = { photo: { findFirst: vi.fn().mockResolvedValue(null) },
               trashedPhoto: { findFirst: vi.fn().mockResolvedValue({ id: "p1" }) } } as never;
  expect(await photoOrTrashedExistsInCatalog("c1", "p1", db)).toBe(true);
});
```
In `apps/web/src/lib/route-helpers.test.ts` add:
```ts
import { binaryResponse } from "./route-helpers.js";
describe("binaryResponse", () => {
  it("sets content-type, immutable cache, and optional attachment disposition", () => {
    const r = binaryResponse(Buffer.from("x"), { contentType: "image/webp" });
    expect(r.headers.get("Content-Type")).toBe("image/webp");
    expect(r.headers.get("Cache-Control")).toContain("immutable");
    const d = binaryResponse(Buffer.from("x"), { contentType: "image/jpeg", downloadAs: "p.jpg" });
    expect(d.headers.get("Content-Disposition")).toBe('attachment; filename="p.jpg"');
  });
});
```

- [ ] **Step 2: Run, verify fail.** `pnpm --filter @lumio/db test -- catalogs`, `pnpm --filter @lumio/web test -- "photos-service|route-helpers"` → FAIL (functions missing).

- [ ] **Step 3: Implement.**

`packages/db/src/catalogs.ts` — append (matches `renameCatalog`'s shape):
```ts
export function setUploadTemplate(id: string, uploadTemplate: string, db: CatalogDb = prisma) {
  return db.catalog.update({ where: { id }, data: { uploadTemplate } });
}
```
`apps/web/src/lib/photos-service.ts` — add (`Db` already = `Pick<PrismaClient, "photo">`; add a 2-model pick for the trashed variant):
```ts
export async function photoExistsInCatalog(catalogId: string, id: string, db: Db = prisma): Promise<boolean> {
  return (await db.photo.findFirst({ where: { id, catalogId }, select: { id: true } })) !== null;
}

export async function photoOrTrashedExistsInCatalog(
  catalogId: string,
  id: string,
  db: Pick<PrismaClient, "photo" | "trashedPhoto"> = prisma,
): Promise<boolean> {
  const [photo, trashed] = await Promise.all([
    db.photo.findFirst({ where: { id, catalogId }, select: { id: true } }),
    db.trashedPhoto.findFirst({ where: { id, catalogId }, select: { id: true } }),
  ]);
  return photo !== null || trashed !== null;
}
```
`apps/web/src/lib/route-helpers.ts` — add:
```ts
/** A binary (image) response with immutable caching and an optional download filename. */
export function binaryResponse(
  file: Buffer,
  opts: { contentType: string; cacheControl?: string; downloadAs?: string },
): NextResponse {
  const headers: Record<string, string> = {
    "Content-Type": opts.contentType,
    "Cache-Control": opts.cacheControl ?? "public, max-age=31536000, immutable",
  };
  if (opts.downloadAs) headers["Content-Disposition"] = `attachment; filename="${opts.downloadAs}"`;
  return new NextResponse(new Uint8Array(file), { headers });
}
```

- [ ] **Step 4: Run tests + tsc.** `pnpm --filter @lumio/db test`, `pnpm --filter @lumio/web test -- "photos-service|route-helpers"` → PASS. `pnpm --filter @lumio/db exec tsc --noEmit`, `pnpm --filter @lumio/web exec tsc --noEmit` → no new errors.

- [ ] **Step 5: Commit.**
```bash
git add packages/db/src/catalogs.ts packages/db/src/catalogs.test.ts apps/web/src/lib/photos-service.ts apps/web/src/lib/photos-service.test.ts apps/web/src/lib/route-helpers.ts apps/web/src/lib/route-helpers.test.ts
git commit -m "db/web: add setUploadTemplate, photo-ownership checks, binaryResponse helper"
```

---

## Task 2: Convert the 4 raw-query routes + add the lint guard

**Files:**
- Modify: `settings/route.ts`, `photos/[id]/thumbnail/route.ts`, `display/route.ts`, `original/route.ts`, `edited/route.ts`
- Modify: `apps/web/eslint.config.*` (the flat config)

- [ ] **Step 1: Convert `settings/route.ts`.** Replace the `prisma.catalog.update({ where: { id: catalog.id }, data: { uploadTemplate } })` with `const updated = await setUploadTemplate(catalog.id, uploadTemplate);` and remove `import { prisma } from "@lumio/db";`, adding `import { setUploadTemplate } from "@lumio/db";`.

- [ ] **Step 2: Convert the image-serving routes.** For each, replace the inline `prisma.photo.findFirst` ownership check with the helper and the local `webp()`/response-builder with `binaryResponse`, dropping `import { prisma }`:
  - `thumbnail/route.ts`: ownership via `await photoOrTrashedExistsInCatalog(catalog.id, id)` (it checks live + trashed); `if (!owned) return errorJson("Not found", 404);` then `binaryResponse(await readFile(thumbnailPath(...)), { contentType: "image/webp" })` (keep the trash-fallback try/catch, both via `binaryResponse`).
  - `display/route.ts`: `await photoExistsInCatalog(catalog.id, id)` → `binaryResponse(..., { contentType: "image/webp" })` (keep the base/edited fallback logic).
  - `original/route.ts` and `edited/route.ts`: read them first. Use `photoExistsInCatalog`; serve via `binaryResponse`. If they honor a `?download` query param (Content-Disposition), pass `downloadAs: <filename>` to `binaryResponse` (preserve the exact current filename/disposition behavior — do NOT change what gets served or the disposition for the non-download case).
  Use `errorJson` (from Task B1) for the 404s instead of `NextResponse.json({ error })`.

- [ ] **Step 3: Add the lint guard.** In `apps/web`'s ESLint flat config (e.g. `eslint.config.mjs`), add an override block targeting the API routes:
```js
{
  files: ["src/app/api/**/*.ts"],
  rules: {
    "no-restricted-syntax": [
      "error",
      {
        selector: "MemberExpression[object.name='prisma']",
        message:
          "Don't query Prisma directly in a route — call a service/@lumio/db function. (Injecting `prisma` as a `db` argument is fine.)",
      },
    ],
  },
}
```
This bans `prisma.photo.…` / `prisma.catalog.…` member access in routes but still permits `db: prisma` (an identifier value, not a member access).

- [ ] **Step 4: Verify the gates.**
```bash
cd /Users/gego/conductor/workspaces/lumio/berlin-v3
# No raw prisma queries left in routes (member access). DI `db: prisma` is allowed and won't match:
grep -rnE "prisma\.[a-zA-Z]+\." apps/web/src/app/api ; echo "^ expect: none"
cd apps/web && pnpm exec eslint src/app/api ; echo "^ expect: clean (the new rule passes)"
```
Run `pnpm -r test` → all green. `pnpm --filter @lumio/web exec tsc --noEmit` → no new errors.

- [ ] **Step 5: Commit.**
```bash
git add -A
git commit -m "web: route raw Prisma queries through services + lint-guard app/api"
```

---

## Self-review
- **Spec coverage (B2 slice):** raw `catalog.update` → `setUploadTemplate` ✓; image-serving raw `findFirst` + copy-pasted `webp()` → ownership helpers + `binaryResponse` ✓; the "no raw Prisma in routes" invariant → `no-restricted-syntax` lint guard ✓ (refined from a blanket import-ban to a query-ban, since `db: prisma` injection is legitimate DI — documented in Architecture).
- **Placeholder scan:** Task 1 fully concrete. Task 2 names the exact routes; `original`/`edited` are read-then-convert (their download-disposition behavior must be preserved exactly — the only judgment call, flagged).
- **Type consistency:** `setUploadTemplate(id, uploadTemplate, db?)` matches `renameCatalog`'s `CatalogDb` shape; `photoExistsInCatalog`/`photoOrTrashedExistsInCatalog` use the existing `Db` / a `"photo" | "trashedPhoto"` pick; `binaryResponse(file, { contentType, cacheControl?, downloadAs? })` consistent between definition, tests, and call sites.
