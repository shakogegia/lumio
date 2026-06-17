# Albums + Smart-Album Engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]` checkboxes.

**Goal:** Regular album CRUD + smart-album rule engine + rule-builder UI, album cards with cover+count. No schema change.

**Architecture:** Unit A = shared Zod/DTOs + db `smartAlbumWhere` evaluator. Unit B = web album service + 7 API routes. Unit C = web UI (`/albums`, `/albums/[id]`, `/photo/[id]` membership) + `PhotoGrid` endpoint refactor.

**Tech stack:** Prisma/Postgres, Next 16 App Router, shadcn (Base UI) Dialog/Button/Card, vitest.

---

## UNIT A — shared schemas/DTOs + db evaluator

### Task A1: shared schemas + DTOs (TDD)
**Files:** `packages/shared/src/albums.ts` (new), `packages/shared/src/albums.test.ts`, update `src/types.ts` + `src/index.ts`.
- Add to `PhotoDTO` (types.ts): `albumIds?: string[];` (optional).
- Add `AlbumSummaryDTO` (types.ts): `AlbumDTO & { photoCount: number; coverPhotoId: string | null }`.
- `albums.ts`:
```ts
import { z } from "zod";
import { MatchType, RuleOp } from "./enums.js";

const last30 = z.object({ field: z.literal("takenAt"), op: z.literal(RuleOp.last_30_days) });
const cameraEq = z.object({ field: z.literal("exif.cameraModel"), op: z.literal(RuleOp.eq), value: z.string().min(1) });
export const smartRuleSchema = z.discriminatedUnion("field", [last30, cameraEq]);
export const smartRulesSchema = z.object({
  match: z.nativeEnum(MatchType),
  rules: z.array(smartRuleSchema).min(1),
});
export const createAlbumSchema = z.object({
  name: z.string().min(1).max(200),
  isSmart: z.boolean().default(false),
  rules: smartRulesSchema.optional(),
}).refine((v) => (v.isSmart ? !!v.rules : !v.rules), {
  message: "smart albums require rules; regular albums must omit rules",
});
export const addPhotoSchema = z.object({ photoId: z.string().min(1) });
export type CreateAlbumInput = z.infer<typeof createAlbumSchema>;
```
- Export from index.ts. Tests: valid last30 rule; valid cameraEq with value; cameraEq without value fails; smart album without rules fails; regular album with rules fails; regular album ok.
- [ ] Write tests → fail → implement → pass. Commit `feat(shared): album + smart-rule Zod schemas and AlbumSummaryDTO`.

### Task A2: db `smartAlbumWhere` evaluator (TDD)
**Files:** `packages/db/src/smart-albums.ts` (new), `packages/db/src/smart-albums.test.ts`, export from `src/index.ts`.
```ts
import type { Prisma } from "@prisma/client";
import { MatchType, RuleOp, type SmartAlbumRules } from "@lumio/shared";

/** Translate smart-album rules to a Prisma Photo where clause. `now` is injected for testability. */
export function smartAlbumWhere(rules: SmartAlbumRules, now: Date): Prisma.PhotoWhereInput {
  if (rules.rules.length === 0) return { id: { in: [] } };
  const clauses = rules.rules.map((r): Prisma.PhotoWhereInput => {
    if (r.field === "takenAt" && r.op === RuleOp.last_30_days) {
      const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      return { takenAt: { gte: cutoff } };
    }
    if (r.field === "exif.cameraModel" && r.op === RuleOp.eq) {
      return { exif: { path: ["cameraModel"], equals: r.value } };
    }
    throw new Error(`unsupported rule: ${r.field}/${r.op}`);
  });
  return rules.match === MatchType.all ? { AND: clauses } : { OR: clauses };
}
```
- Tests (fixed `now = new Date("2026-06-17T00:00:00Z")`): last_30_days produces `takenAt.gte` = now-30d; cameraEq produces the JSON path clause; `all`→AND, `any`→OR; empty rules → `{id:{in:[]}}`; an unknown combo (construct via `as never`) throws.
- [ ] Write tests → fail → implement → pass; `typecheck`. Commit `feat(db): smartAlbumWhere rule evaluator`.

---

## UNIT B — web album service + API routes

### Task B1: album service (TDD where pure)
**Files:** `apps/web/src/lib/albums-service.ts` (rewrite), `apps/web/src/lib/albums-service.test.ts`.
Functions (all take `db = prisma`, injectable):
- `listAlbumSummaries()` → for each album: `photoCount` + `coverPhotoId`. Regular: `albumPhoto.count({where:{albumId}})` + first `albumPhoto` (ordered by photo.sortDate desc) → photoId. Smart: `photo.count({where: smartAlbumWhere(rules, new Date())})` + `findFirst` ordered `sortDate desc,id desc` → id. Return `AlbumSummaryDTO[]`.
- `getAlbum(id)` → `AlbumDTO | null`.
- `createAlbum(input: CreateAlbumInput)` → create row (rules as JSON for smart) → `AlbumDTO`.
- `deleteAlbum(id)` → delete (cascade).
- `listAlbumPhotos(id, {limit, cursor})` → `PhotosPage`. Regular: `photo.findMany({ where: { albums: { some: { albumId: id } } }, take, cursor, skip, orderBy:[{sortDate:desc},{id:desc}] })`. Smart: same but `where: smartAlbumWhere(rules, new Date())`. nextCursor = last id when full page.
- `addPhotoToAlbum(albumId, photoId)` → if album.isSmart throw a typed error (mapped to 400); else `albumPhoto.upsert`. `removePhotoFromAlbum` → `deleteMany`.
- Update `getPhoto` (photos-service) to also return `albumIds` (from `albumPhoto.findMany({where:{photoId}})`).
- [ ] TDD the pure-shaping bits with a fake db (summary fields; pagination nextCursor; add-to-smart throws). Commit `feat(web): album service with smart evaluation`.

### Task B2: API routes
**Files:** under `apps/web/src/app/api/albums/...` and update `apps/web/src/app/api/photos/[id]/route.ts` (include albumIds via getPhoto).
- `albums/route.ts`: `GET` → `listAlbumSummaries`; `POST` → `createAlbumSchema.safeParse` → `createAlbum` (201) / 400.
- `albums/[id]/route.ts`: `GET` → `getAlbum` or 404; `DELETE` → `deleteAlbum` (204).
- `albums/[id]/photos/route.ts`: `GET` (photosQuerySchema) → `listAlbumPhotos`; `POST` (addPhotoSchema) → add (201) / 400 smart / 404.
- `albums/[id]/photos/[photoId]/route.ts`: `DELETE` → remove (204 / 400 smart).
- All `runtime="nodejs"`, dynamic. Await `params`.
- [ ] Verify with `pnpm --filter @lumio/web build` (all routes compile + listed). Commit `feat(web): album + smart-album API routes`.

---

## UNIT C — web UI

### Task C1: PhotoGrid endpoint refactor
- `photo-grid.tsx`: add prop `endpoint?: string` (default `/api/photos`); `fetchPage` builds from it. `/photos/page.tsx` unchanged (uses default). Verify build + existing tests.
- [ ] Commit `refactor(web): make PhotoGrid endpoint-configurable`.

### Task C2: /albums (cards + New Album dialog with rule-builder)
- Add shadcn `dialog`, `input`, `select` (or native select), `label` components if missing (`pnpm dlx shadcn add dialog input label` — handle Base UI API). 
- `/albums/page.tsx` (server): `listAlbumSummaries` → cover+count cards (cover `<img src="/api/thumbnails/:coverPhotoId">` or placeholder), regular/smart sections; render a client `NewAlbumDialog`.
- `new-album-dialog.tsx` (client): name input, smart toggle; when smart, rule-builder (match all/any select; add-rule rows choosing "Taken in last 30 days" or "Camera model equals" + value input). Submit → `POST /api/albums` → `router.refresh()`.
- [ ] Verify in browser (create regular + smart). Commit `feat(web): albums page with cover cards and rule-builder`.

### Task C3: /albums/[id] detail + /photo/[id] membership
- `/albums/[id]/page.tsx` (server): `getAlbum` (404 → notFound), header (name, count, `DeleteAlbumButton` client → `DELETE` → redirect `/albums`), `<PhotoGrid endpoint={`/api/albums/${id}/photos`} />`.
- `/photo/[id]`: pass `albumIds` + regular albums to a client `AlbumMembership` control in the Sheet (toggle add/remove via `POST`/`DELETE`, `router.refresh()`).
- [ ] Verify in browser. Commit `feat(web): album detail page and photo album-membership`.

---

## Final verification
- [ ] `pnpm -r test` green; `pnpm --filter @lumio/web build` clean.
- [ ] Browser: create regular album → add a photo from `/photo/[id]` → appears in `/albums/[id]`; create smart album (camera model eq "TestCam 1") → auto-populates with cover+count; delete an album.

## Self-review notes
- `smartAlbumWhere` takes `now` as an arg → pure + testable; services pass `new Date()`.
- Album-photos endpoint returns `PhotosPage` so the virtualized grid is reused unchanged.
- Membership mutation only valid for regular albums (smart → 400).
