# Lumio — Uploads Through the Pipeline Design

**Date:** 2026-06-18
**Status:** Approved (design)
**Builds on:** walking-skeleton, format support, albums (roadmap #4)

## Goal
Let people add photos through the web app: a drag-and-drop **Upload** page (sidebar peer of Photos/Albums) that streams files to the server, files them into `/photos` using a configurable **folder template**, dedups identical content, and ingests each file **synchronously** through the existing pipeline so it appears in the library immediately. The template is edited in **Settings** and persisted in Postgres.

## Decisions (brainstorm)
1. **Free-form token template** (not presets or a builder). One editable pattern string; default `{YYYY}/{YYYY}-{MM}-{DD}/{filename}` (year folder → day folder → file).
2. **Content-hash dedup.** If an uploaded file's sha256 matches an indexed photo, skip it ("already in library"); no second copy is written. Filename collisions where the *content differs* get a numeric suffix.
3. **Synchronous / live processing.** The web route runs the ingestion pipeline inline so the page shows per-file status and photos appear at once. The pipeline is **extracted into a shared package** both the worker and web import.
4. **Date source for the template:** EXIF `takenAt` → file `lastModified` (sent by client) → upload time.
5. **Settings persisted in Postgres** as a single-row typed table (not a JSON file or env var).
6. Template changes apply to **new uploads only**; the existing library is never re-organized.

## Architecture: extract `packages/ingest`
Move the trigger-agnostic pipeline out of `apps/worker` into a new shared package so the upload path (web) and the scan/watch path (worker) share one verified implementation.

**Moves into `packages/ingest`:**
- `processImage` (decode → EXIF/hash/dimensions → thumbnail + display buffers) — from `apps/worker/src/pipeline/process.ts`.
- `storePhoto` (upsert by path + write thumbnail/display) — from `pipeline/store.ts`.
- `ingestPath`, `removePath` — from `apps/worker/src/ingest.ts`.
- `decodeToReadable` and the decoder helpers — from `pipeline/decode.ts`.
- Pure constants: `SUPPORTED_EXTENSIONS`, `THUMBNAIL_MAX`, `DISPLAY_MAX`.
- Their unit tests move with them (`process.test.ts`, `store.test.ts`, `decode.test.ts`, `ingest.test.ts`).

**Stays per-app (deliberately):** directory resolution. `processImage`/`storePhoto`/`ingestPath` already accept dirs via a `deps` argument. Each app keeps its own resolver — worker `config.ts`, web `lib/paths.ts` — and passes `photosDir`/`thumbnailsDir`/`displaysDir` in. The shared package does **not** export a root-resolving config module. This avoids the known Next `--webpack` / `import.meta.url` path-resolution mismatch (the worker resolves the repo root from `import.meta.url`; web resolves it from `process.cwd()`), keeping that difference isolated to each app.

**Worker changes:** `scan.ts`, `watch.ts`, `main.ts`, `watch-main.ts` re-point imports to `@lumio/ingest`. `apps/worker/src/config.ts` keeps `PHOTOS_DIR`/`CACHE_DIR`/dir resolution and re-exports / imports the pure constants from `@lumio/ingest`. **Regression guard:** all existing worker tests pass unchanged after the move.

**New in `packages/ingest`:**
- `findPhotoByHash(hash, deps): Promise<{ id: string } | null>` — dedup lookup.
- `placeUpload({ bytes, relPath, photosDir }): Promise<string>` — collision-safe write: if the target exists on disk, append `-1`, `-2`, … to the filename stem until free; write the bytes; return the final relPath. Reuses the path-traversal guard (resolved path must stay within `photosDir`).

## `@lumio/shared` — template engine (pure)
- `renderTemplate(template: string, ctx: { date: Date; originalFilename: string }): string` — returns a POSIX relative path.
  - Tokens: `{YYYY}` (4-digit year), `{MM}` (2-digit month), `{DD}` (2-digit day), `{filename}` (sanitized original filename **including** its extension), `{ext}` (extension without the dot). `{camera}` deferred unless trivial.
  - Filename sanitization: strip path separators and control chars, collapse whitespace; preserve the original extension.
- `validateTemplate(template: string): { ok: true } | { ok: false; error: string }` — rejects: empty; missing both `{filename}` and `{ext}` (would collapse files into one name); any `..` segment; leading `/`. Used by the Settings form and defensively in the upload route.
- Unit-tested: token substitution, sanitization, every rejection case.

## `@lumio/db` — settings store
New Prisma model + migration:
```prisma
model AppSettings {
  id             Int      @id @default(1)   // single-row sentinel
  uploadTemplate String   @default("{YYYY}/{YYYY}-{MM}-{DD}/{filename}")
  updatedAt      DateTime @updatedAt
}
```
- `getSettings()` — get-or-create the `id=1` row with defaults; returns the typed settings.
- `updateSettings({ uploadTemplate })` — upsert the `id=1` row.
- Unit-tested: get-or-create returns defaults on an empty table; update persists.

## Web API (Node runtime, Zod-validated)
- `POST /api/uploads` (`runtime="nodejs"`) — one file per request (multipart/form-data: `file`, optional `lastModified`). Per file:
  1. Extension ∈ `SUPPORTED_EXTENSIONS`, else `415` `{ status: "unsupported" }`.
  2. Read bytes to a Buffer; compute sha256.
  3. `findPhotoByHash` → if found, `200 { status: "duplicate", id }` (**no write**).
  4. Date = EXIF `takenAt` (light `exifr` parse of the buffer) → `lastModified` → now.
  5. `renderTemplate(getSettings().uploadTemplate, { date, originalFilename })`; `validateTemplate` defensively.
  6. `placeUpload` → write original into `/photos` (web dirs).
  7. `ingestPath(relPath, webDeps)` → upsert `Photo{ source: upload }` + thumbnail/display.
  8. `200 { status: "added", id, path }`.
  - On an ingest failure after the write, best-effort `unlink` the just-written original so `/photos` stays consistent; return `500 { status: "error", message }`.
- `PUT /api/settings` — body `{ uploadTemplate }`, validated by `validateTemplate`; `updateSettings`; returns the saved settings. (`GET` not required — the Settings page reads via `getSettings()` server-side.)

## Web UI
- **Sidebar** (`app-sidebar.tsx`): add `Upload` (lucide `UploadCloud`) to the primary nav.
- **Upload page** (`/upload`): a drop zone (drag-drop or click-to-pick). Each selected file is a queue row with status `queued → uploading → processing → ✓ Added / ⊘ Already in library / ✗ <error>`. Client uploads with small concurrency (e.g. 3 in flight), one request per file. A done-state CTA links back to `/photos`.
- **Settings page**: new "Uploads" card — template text input, token legend, a **live example preview** (e.g. `2026/2026-06-18/IMG_1234.jpg` rendered from the current input), inline validation, and Save (`PUT /api/settings`). Reuses existing `Card`/`Button` components and the established styling.

## Error handling
- Unsupported type → `415`; row: "Unsupported format."
- Duplicate → `200 {status:"duplicate"}`; row: "Already in library."
- Decode/processing failure → `500 {status:"error"}`; row shows the message; written original is best-effort removed.
- Invalid template → rejected by `validateTemplate` before save (Settings) and before write (upload route).
- Path traversal → blocked by `validateTemplate` (no `..`/leading `/`) and by `placeUpload`'s within-`photosDir` guard.

## Testing
- **shared:** `renderTemplate` tokens + sanitization; `validateTemplate` rejections; date-fallback selection.
- **ingest:** `findPhotoByHash`; `placeUpload` collision suffixing (temp dir); dedup short-circuit. Existing moved tests still pass.
- **db:** `getSettings` get-or-create defaults; `updateSettings` persists.
- **web:** `POST /api/uploads` — added / duplicate / unsupported / template-applied-path (temp photos dir + test DB, matching existing web tests).
- **regression:** all existing worker tests pass after the `packages/ingest` extraction.

## Non-goals (YAGNI)
No zip or folder-structure-preserving upload, no client-side resize, no chunked/resumable uploads, no retry queue beyond per-file status, no auth (roadmap #5), and **no re-organization of already-imported photos when the template changes** (new uploads only).
