# Lumio — Rich EXIF Extraction & Folder Upload Design

**Date:** 2026-06-18
**Status:** Approved (design)
**Builds on:** uploads (roadmap #4), format support, photo-detail pane

## Goal
Two related improvements:

1. **Capture all the metadata.** Today ingest parses the full EXIF block but keeps only four fields (`takenAt`, `cameraMake`, `cameraModel`, `orientation`) and discards everything else — ISO, aperture, shutter speed, focal length, lens, GPS, and all XMP/IPTC. Enrich extraction so the stored blob contains everything an online EXIF viewer would show, **including embedded XMP** (which transparently covers metadata written by tools like filmexif's *embed* mode), and surface it in the photo detail view.
2. **Folder upload.** Let people drop a whole folder onto the Upload dropzone; recurse into subfolders, upload every supported image, and **skip unsupported files** (RAW, `.xmp`, `.txt`, etc.) with a visible count.

## Decisions (brainstorm)
1. **Read everything, store flat.** Enable all exifr blocks (TIFF/EXIF/GPS/XMP/IPTC) with `mergeOutput: true` and persist the whole sanitized object. Accept that merge flattens per-block namespaces into one key space (a tag in two blocks collapses to one value) — the right tradeoff for a "dump everything" view.
2. **Embedded XMP only; sidecars deferred.** `exifr` reads custom XMP namespaces fine when XMP is *embedded* in the image (verified: it returns `FilmStock`, `FilmISO`, etc. from filmexif's namespace when `{ xmp: true }`). It **cannot** parse a bare `.xmp` sidecar ("Unknown file format"), which would need a separate XMP/XML code path. Sidecars are **out of scope for now**; a stray `.xmp` in a dropped folder is simply skipped as unsupported.
3. **Full key/value dump in the UI.** The photo detail "Show all EXIF" becomes a complete two-column key/value table of every metadata entry (no curation), replacing today's `JSON.stringify` blob.
4. **Preserve curated keys for compatibility.** `takenAt`, `cameraMake`, `cameraModel`, `orientation` are still derived and kept as top-level keys so sorting (`takenAt`) and smart-album filtering (`exif.cameraModel`) keep working unchanged.
5. **No DB migration.** Still the existing `Photo.exif` JSONB column; only its contents grow.
6. **Backfill is automatic.** `apps/worker/src/scan.ts` `scanAndIngest()` re-ingests every file in `PHOTOS_DIR` on startup (upsert by path, re-running `processImage`), and uploaded photos live in `PHOTOS_DIR` too. A worker restart backfills the whole library — no separate migration script.
7. **Recursive folder upload, date-template filing unchanged.** Dropped folders recurse into subfolders. Files are still filed by the existing `uploadTemplate` (e.g. `{YYYY}/{YYYY}-{MM}-{DD}/{filename}`); the dropped folder's structure is **not** mirrored into `/photos`.

## Environment facts (verified)
- `exifr@7.1.3`. Two call sites today, both with **default options**: `packages/ingest/src/process.ts` (full ingest) and `packages/ingest/src/upload-date.ts` (date-only, for filing).
- With default options exifr returns **no** XMP at all. With `{ xmp: true }` it parses embedded XMP including unknown/custom namespaces, flattened into the output (e.g. `FilmISO → 400` as a number).
- exifr revives date fields to `Date` objects and can return binary blobs — both must be sanitized before they go into JSONB.
- `SUPPORTED_EXTENSIONS` (`packages/ingest/src/constants.ts`): `.jpg .jpeg .png .webp .jxl .heic .heif`.

## `packages/ingest` — extraction
New module `packages/ingest/src/metadata.ts`:

- `extractMetadata(buffer: Buffer): Promise<{ exif: ExifData; takenAt: Date | null }>`
  - Calls `exifr.parse(buffer, { tiff: true, exif: true, gps: true, xmp: true, iptc: true, jfif: true, ihdr: true, interop: true, mergeOutput: true })`, catching parse errors to `{}` (same resilience as today).
  - Runs the result through `sanitizeMetadata`.
  - Derives and overlays the curated keys: `takenAt` (from `DateTimeOriginal ?? CreateDate`, ISO string), `cameraMake` (`Make`, trimmed), `cameraModel` (`Model`, trimmed), `orientation` (`Orientation`, number). Curated keys win on top of the raw dump.
  - Returns both the merged `exif` object (`{ ...sanitizedRaw, ...curated }`) and the parsed `takenAt: Date | null`, so `processImage` can store the date in the `Photo.takenAt`/`sortDate` columns while staying declarative.
- `sanitizeMetadata(value): JSON-safe value` — pure, recursive: `Date → ISO string`; drop `Buffer`/`TypedArray`/`ArrayBuffer`/functions; recurse plain objects and arrays; pass primitives through. Guarantees the result is JSON-serializable for the JSONB column.

`packages/ingest/src/process.ts` (lines ~31-38) is refactored to call `extractMetadata(original)` instead of the inline `exifr.parse` + hand-built object. No other change to `process.ts` (sharp renditions, hash, dimensions unchanged).

`packages/ingest/src/upload-date.ts` is left as-is functionally (it only needs the date for filing and runs *before* ingest); optionally it can reuse a tiny shared `parseExifDate` helper, but no behavior change.

## `@lumio/shared` — types
`packages/shared/src/types.ts` `ExifData`: keep the four curated optional fields and the `[key: string]: unknown` passthrough; update the comment to reflect that the object now holds the full sanitized metadata dump, not just four fields. No structural change required.

## Web — photo detail display
`apps/web/src/app/(app)/photo/[id]/photo-detail.tsx`:
- Keep the top summary rows (Camera, Taken, Hash) as they are.
- Replace the `<pre>{JSON.stringify(photo.exif)}</pre>` inside "Show all EXIF" with a **two-column key/value table**: one row per entry in `photo.exif`, keys sorted alphabetically, values rendered as readable strings (objects/arrays `JSON.stringify`'d compactly, scalars as-is). Empty/no-metadata → a muted "No metadata" line.

## Web — folder drop upload
`apps/web/src/app/(app)/upload/upload-client.tsx`:
- **Folder-aware intake.** New helper `collectFiles(dataTransfer): Promise<File[]>` that:
  - For a drop, walks `DataTransferItem.webkitGetAsEntry()` entries recursively (directory readers, batched until drained) to flatten folders into a `File[]`.
  - Falls back to `dataTransfer.files` when the entries API is unavailable.
  - Is unit-testable via a small injectable entry shape (no real DOM needed).
- **Folder picker affordance.** Add a "select folder" path using `<input type="file" webkitdirectory />` alongside the existing file picker, so click-to-choose-a-folder also works.
- **Skip unsupported.** Client filters the collected files against `SUPPORTED_EXTENSIONS` before queueing. Unsupported files are not uploaded; the UI shows a **"Skipped N unsupported file(s)"** summary. The server's existing `415 unsupported` stays as a backstop.
- **Unchanged:** bounded upload concurrency (3 in flight), one `POST /api/uploads` per file, per-file status rows, date-template filing, dedup-by-hash.

No server route changes required — `POST /api/uploads` already handles one file per request and returns `415`/`200 duplicate`/`201 added`/`500`.

## Backfill
No code. Documented operationally: after deploy, **restart the worker** so `scanAndIngest()` re-processes `PHOTOS_DIR` and rewrites each `Photo.exif` with the richer blob (and regenerates renditions, as it already does). Note in `docs/STATUS.md` if appropriate.

## Testing
- **ingest / `metadata.test.ts`:**
  - ExifIFD fields now surface: build a fixture via `sharp(...).withExif({ ExifIFD: { FNumber, ISO, FocalLength }, IFD0: { Make, Model }, IFD2: { DateTimeOriginal } })` and assert those keys appear in the returned `exif`.
  - Embedded custom-namespace XMP: a small fixture helper splices an XMP APP1 segment into a JPEG (the `0xFFE1` + `http://ns.adobe.com/xap/1.0/\0` + packet construction), then assert e.g. `FilmStock`/`FilmISO` appear.
  - `sanitizeMetadata`: `Date → ISO string`, `Buffer`/typed-array dropped, nested objects/arrays recursed, primitives preserved; output passes `JSON.stringify` without throwing.
  - Curated overlay: `cameraMake`/`cameraModel`/`takenAt`/`orientation` still present and correct.
- **ingest / `process.test.ts`:** update expectations to the enriched `exif` (existing camera/date/null-EXIF assertions still hold).
- **web / `collectFiles`:** recursion over a mocked directory entry tree; unsupported-extension filtering; fallback to `dataTransfer.files`.
- **regression:** existing worker, ingest, and web tests pass unchanged.

## Non-goals (YAGNI)
- **XMP sidecar files** (`.xmp`, either `IMG.jpg.xmp` append or `IMG.xmp` replace conventions) — deferred; skipped as unsupported for now.
- **RAW/TIFF formats** (`.tif`, `.dng`, `.nef`, …) — not added; out of scope.
- **Per-block / namespaced metadata view** — flat merged dump only.
- **Mirroring dropped folder structure** into `/photos` — filing stays date-template-based.
- **Re-ingest UI / migration script** — backfill is via worker restart.
- **Client-side resize, chunked/resumable uploads, zip upload.**
