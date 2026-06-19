# Photo download — design

Date: 2026-06-19

Let users download original photo files from three places:

1. **Photo detail page** — download the single original.
2. **Bulk toolbar** (Library + Album select mode) — download the selected photos.
3. **Album header** — download the whole album as one file.

Downloads always deliver the **original** bytes (`PHOTOS_DIR/{photo.path}`),
untouched — full quality, original format (JPEG/PNG/WebP/HEIC/etc.). A single
photo downloads as the bare file; two or more photos (and whole albums) download
as one streamed **ZIP**.

## Background

- Originals live at `PHOTOS_DIR/{photo.path}`; `lib/paths.ts#originalPath`
  resolves that path with a traversal guard. Cached renditions
  (`displays/`, `thumbnails/`) are not used for download.
- `GET /api/photos/[id]/original` already serves an original file inline
  (`Content-Type` + `Cache-Control`, no `Content-Disposition`). It is currently
  an **orphan** — nothing in the UI links to it — so adding an opt-in
  attachment mode is safe.
- `lib/albums-service.ts#albumPhotoWhere(albumId)` returns a Prisma `where` that
  resolves an album's photos for **both** smart (rule-based) and regular
  (membership) albums, or `null` if the album is gone. This is the same helper
  the grid and neighbor queries use.
- Selection state comes from `lib/use-grid-selection.ts` (`sel.selected` is a
  `Set<string>` of photo ids). `library-view.tsx` and `album-view.tsx` both
  render `SelectionToolbar` with page-specific action buttons.
- Bulk request bodies use the existing `photoIdsSchema` (`{ ids: string[] }`)
  from `@lumio/shared`. No shared-package change is needed.
- All API routes are wrapped in `withAuth`. There is **no** zip library yet.

## 1. Zip core — `lib/download-service.ts` (new)

The single, testable place that turns a list of photos into a streaming zip
`Response`. Used by both the bulk and album routes.

- **`streamPhotosZip(photos: { id: string; path: string }[], zipName: string): Response`**
  - Creates an `archiver("zip", { store: true })` archive — **stored, not
    compressed**, because originals (JPEG/PNG/WebP/HEIC) are already compressed;
    storing avoids wasted CPU and streams faster.
  - Pipes the archive into a `node:stream` `PassThrough`, converts it with
    `Readable.toWeb(passthrough)`, and returns a `Response` whose body is that
    web stream, with headers:
    - `Content-Type: application/zip`
    - `Content-Disposition: attachment; filename="<ascii fallback>"; filename*=UTF-8''<percent-encoded zipName>`
  - Adds each photo via `archive.file(originalPath(p.path), { name, store: true })`
    where `name` comes from `dedupeEntryName` (below). Calls `archive.finalize()`
    without awaiting — the archive streams as the response is consumed.
  - **Missing/unreadable originals are skipped, not fatal:** archiver emits a
    `warning` (e.g. `ENOENT`) and continues; the handler logs it. An archive
    `error` destroys the stream. A photo whose original is gone simply does not
    appear in the zip.
- **`dedupeEntryName(basename: string, used: Set<string>): string`** — entries
  are **flattened to basenames** (not the source date-folder tree, since a
  selection is expected to unzip into a flat folder). Collisions across folders
  are de-duplicated by inserting a counter before the extension:
  `IMG_1.jpg`, then `IMG_1 (2).jpg`, `IMG_1 (3).jpg`, … The chosen name is added
  to `used`.
- **`sanitizeZipName(name: string): string`** — turns an album name into a safe
  download filename: strip/replace path separators and control/reserved
  characters, collapse whitespace, trim, cap length, fall back to `album` when
  empty. Always returns a value ending in `.zip` (or the caller appends it).

## 2. Routes

### `GET /api/photos/[id]/original` (edit existing)

When the request has a truthy `download` query param (`?download=1`), add
`Content-Disposition: attachment; filename*=UTF-8''<basename of photo.path>`
to the existing response. Without the param the route behaves exactly as today
(inline). Single-file body handling stays as `readFile` (matching the current
route); streaming a single large original is a possible later improvement, out
of scope here.

### `POST /api/photos/download` (new)

- Body validated by `photoIdsSchema` → `{ ids }`.
- Loads `{ id, path }` for those ids (`prisma.photo.findMany`, ordered by
  `PHOTO_ORDER` for a stable zip order), then returns
  `streamPhotosZip(photos, "lumio-photos-<count>.zip")`.
- 400 on invalid body; if no ids resolve to existing photos, returns 404.
- `runtime = "nodejs"`, wrapped in `withAuth`. Used by the bulk toolbar for 2+.

### `GET /api/albums/[id]/download` (new)

- Resolves the album's photos via `albumPhotoWhere(id)`:
  - `null` → 404 (album gone).
  - otherwise `prisma.photo.findMany({ where, orderBy: PHOTO_ORDER, select: { id, path } })`.
- Returns `streamPhotosZip(photos, "<sanitizeZipName(album.name)>.zip")`. An
  empty album yields a valid **empty** zip (no error page), so the native-anchor
  download in the header never lands the user on a JSON error.
- `runtime = "nodejs"`, `dynamic = "force-dynamic"`, wrapped in `withAuth`.

## 3. Client — `lib/download-client.ts` (new)

DRY helpers shared by the two selection toolbars; the detail page and album
header use plain anchors and do not need these.

- **`downloadFromUrl(url: string): void`** — create a hidden `<a href=url>`,
  click it, remove it. The server's `Content-Disposition` supplies the filename.
  Used for single-file and album GET downloads.
- **`downloadSelection(ids: string[]): Promise<void>`** — the bulk orchestrator:
  - `ids.length === 1` → `downloadFromUrl("/api/photos/<id>/original?download=1")`.
  - `ids.length >= 2` → `POST /api/photos/download` with `{ ids }`,
    `await res.blob()`, then save via an object-URL anchor with
    `a.download = "lumio-photos-<n>.zip"` (blob URLs ignore `Content-Disposition`,
    so the client sets the name), and revoke the object URL afterward.
  - Throws on a non-OK response so callers can `toast.error`.

## 4. UI wiring

- **`photo/[id]/photo-detail.tsx`** — a **Download** button in the Info tab,
  just above the `<Separator />` that precedes `DeletePhotoButton`. Rendered as
  `Button asChild` wrapping an `<a href="/api/photos/<id>/original?download=1">`
  with a `Download` icon. Works identically on the standalone page and the modal
  overlay.
- **`photos/library-view.tsx`** selection toolbar — a **Download** button before
  Delete. `onClick` runs `downloadSelection([...sel.selected])` inside a
  `downloading` pending state (label → "Preparing…", button disabled), with
  `toast.error` on failure. Disabled when `sel.count === 0`. Selection is left
  intact after download (you may want to do something else with the same set).
- **`albums/[id]/album-view.tsx`**:
  - **Normal header** — a **Download** button next to `DeleteAlbumButton`
    (`Button asChild` → `<a href="/api/albums/<id>/download">`, `Download` icon).
    Always enabled (empty album → empty zip).
  - **Selection toolbar** — the same `downloadSelection` Download button as
    Library, for downloading a hand-picked subset of the album.

## 5. New dependency

`archiver` (runtime) + `@types/archiver` (dev) added to `apps/web`. Mature,
streaming zip library with stored-entry support. Installed with the repo's
package manager (pnpm workspace).

## Known tradeoff

The **selection** zip (`POST` → `res.blob()`) buffers the whole zip in browser
memory before the save dialog, because browsers cannot stream a `fetch`
response to disk without the not-universally-available File System Access API.
This is acceptable: selections are hand-picked (tens to low hundreds of files).
The **album** download — the genuinely unbounded case — uses the native GET
anchor and streams straight to disk with flat server memory. If selection sizes
ever grow large enough to matter, the upgrade path is a short-lived download
token (`POST` the ids → token) plus a `GET ?token=` streaming route; that is
deliberately out of scope for v1.

## Testing

- **Unit (`lib/download-service.test.ts`, new):**
  - `dedupeEntryName` — first name passes through; collisions get
    ` (2)`, ` (3)` suffixes before the extension; `used` set is honored.
  - `sanitizeZipName` — strips path separators / reserved chars, collapses
    whitespace, falls back to `album` on empty/whitespace input.
  - `streamPhotosZip` — write temp originals, build the zip, read entries back
    (e.g. via `yauzl`/`adm-zip` in the test, or unzip to a temp dir) and assert
    the expected entry names/contents are present and a missing-file photo is
    skipped without throwing.
- **Manual (browser):**
  - Detail page Download saves the original with its real filename (page + modal).
  - Library: select 1 → bare file; select 3 → `lumio-photos-3.zip` with 3 files.
  - Album header Download → `<album>.zip` with all photos, for a smart album and
    a regular album.
  - Album select-mode Download → subset zip.
  - A label/error toast appears if a bulk download request fails.

## Out of scope

- Downloading processed/display renditions or a format/size picker.
- Preserving the source folder tree inside zips (flattened by design).
- Token-staged streaming for very large selections (upgrade path noted above).
- Progress bars / percentage for zip preparation (simple pending state only).
- Resumable / range downloads.
