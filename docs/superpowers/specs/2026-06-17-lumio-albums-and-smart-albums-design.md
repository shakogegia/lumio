# Lumio — Albums + Smart-Album Engine Design

**Date:** 2026-06-17
**Status:** Approved (design)
**Builds on:** walking-skeleton (follow-up #3)

## Goal
Make albums real: regular album CRUD (create, view, add/remove photos, delete), a smart-album **rule engine** that computes membership at query time, and a **rule-builder UI** to create smart albums. Album cards show a cover thumbnail + photo count.

## Decisions (brainstorm)
1. Album CRUD is **detail-page driven** (no grid multi-select): create from `/albums`, view at `/albums/[id]`, add/remove a photo to/from regular albums on `/photo/[id]`.
2. Smart albums: **rule engine + display AND a UI rule-builder**. Membership is **live-computed** (no caching).
3. Album cards show **cover thumbnail + name + count**.

No schema change — `Album { id, name, isSmart, rules Json?, ... }`, `AlbumPhoto { albumId, photoId }`, and `SmartAlbumRules`/`SmartAlbumRule` types already exist.

## Supported smart-album rules (bounded)
Exactly two rule types (keeps the engine + builder aligned):
- **Taken in the last 30 days** — `{ field: "takenAt", op: "last_30_days" }` (no value).
- **Camera model equals X** — `{ field: "exif.cameraModel", op: "eq", value: "<string>" }`.
Plus `match: "all" | "any"`.

## `@lumio/shared`
- `smartRuleSchema` — Zod discriminated union of the two allowed rule shapes; `smartRulesSchema = { match: MatchType, rules: smartRuleSchema[] }`.
- `createAlbumSchema` — `{ name: string(1..), isSmart: boolean default false, rules?: smartRulesSchema }`; refine: `rules` required when `isSmart`, forbidden otherwise.
- `addPhotoSchema` — `{ photoId: string }`.
- `AlbumSummaryDTO` = `AlbumDTO & { photoCount: number; coverPhotoId: string | null }`.
- `PhotoDTO` gains optional `albumIds?: string[]` (populated only by `getPhoto` for the membership UI; omitted in list responses).

## `@lumio/db`
- `smartAlbumWhere(rules: SmartAlbumRules): Prisma.PhotoWhereInput` — pure translation:
  - `takenAt/last_30_days` → `{ takenAt: { gte: <Date now-30d passed in> } }` (the cutoff Date is passed in as an arg so the function stays pure/testable).
  - `exif.cameraModel/eq` → `{ exif: { path: ["cameraModel"], equals: value } }` (Postgres JSON path).
  - `match: all` → `{ AND: [...] }`; `any` → `{ OR: [...] }`.
  - empty rules → a never-match clause (`{ id: { in: [] } }`).
  - Throws on an unrecognized (field, op) pair (defensive; Zod prevents it at the edge).
- Unit-tested with a fixed cutoff date.

## Web API (all Node runtime, Zod-validated)
- `GET /api/albums` → `{ items: AlbumSummaryDTO[] }` — regular + smart, each with `photoCount` + `coverPhotoId` (regular via join count + first AlbumPhoto; smart via `count`/`findFirst` using `smartAlbumWhere`, ordered `sortDate desc, id desc`).
- `POST /api/albums` → create (regular or smart) → `AlbumDTO` (201).
- `GET /api/albums/:id` → `AlbumDTO` (404 if missing).
- `DELETE /api/albums/:id` → 204 (AlbumPhoto cascade).
- `GET /api/albums/:id/photos?limit=&cursor=` → `PhotosPage` — regular: photos joined via `AlbumPhoto`; smart: photos matching `smartAlbumWhere`. Same ordering + `id` cursor as `/api/photos`.
- `POST /api/albums/:id/photos` `{ photoId }` → add to a **regular** album (idempotent upsert on the join); `400` if the album is smart; `404` if album/photo missing.
- `DELETE /api/albums/:id/photos/:photoId` → remove from a regular album (204; `400` if smart).

## Web UI
- **Refactor `PhotoGrid`** to accept an `endpoint` prop (default `/api/photos`) so it's reused for album detail (`/api/albums/:id/photos`). All virtualization/infinite-scroll logic unchanged.
- **`/albums`** — cover+count cards (cover = `coverPhotoId` → `/api/thumbnails/:id`, fallback placeholder), split into Albums / Smart Albums; link to `/albums/[id]`. A **"New album"** shadcn `Dialog`: name input, "smart" toggle; when smart, the **rule-builder** — a `match` all/any select + add/remove rule rows (each row picks one of the two rule types; the camera-model type shows a value input). Submit → `POST /api/albums` → refresh.
- **`/albums/[id]`** — header (name, count, **Delete** button → `DELETE` → redirect to `/albums`) + the reused virtualized grid pointed at the album's photos endpoint.
- **`/photo/[id]`** — in the detail Sheet, an **Albums** section listing regular albums with a toggle per album to add/remove this photo (uses the photo's `albumIds` + `POST`/`DELETE`).

## Error handling
- Zod failures → 400; missing album/photo → 404; smart-album mutation of membership → 400; delete is idempotent.
- Smart eval is read-only and bounded by pagination.

## Testing
- **shared:** Zod schemas (valid/invalid rule shapes; isSmart/rules refinement).
- **db:** `smartAlbumWhere` for each rule type, all/any, empty, and unknown-combo throw (fixed cutoff date).
- **web:** album service unit tests with fake db (summary shaping, add-to-smart rejected, album-photos pagination shape); route param validation.
- **gate:** `pnpm -r test` + `pnpm --filter @lumio/web build` green; browser-verify: create a regular album + add a photo; create a smart album (camera model eq "TestCam 1") and see it auto-populate with cover+count; album detail grid renders.

## Non-goals
- No grid multi-select/bulk add, no rule editing UI (create+delete only), no caching of smart membership, no nested/boolean-group rules beyond all/any, no album cover selection (first photo only).
