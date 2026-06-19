# Upload page redesign

**Date:** 2026-06-19
**Status:** Approved (pre-approved by user; building via subagent-driven development)

## Problem

The upload page (`apps/web/src/app/(app)/upload/`) is the visual odd-one-out. It uses
a bare `<h1>` instead of the shared sticky `HeaderBar` every other top-level page uses,
a single dashed drop zone, and a flat text list of `filename — status` rows. It feels
"super basic": no visual hierarchy, no progress/summary feedback, no thumbnails, and no
way to act on what you just uploaded without leaving for `/photos`.

## Goal

Rebuild the upload page as a first-class, app-consistent experience: a real header
toolbar, a thumbnail tile grid with live per-file status, a batch command bar with
progress → summary → actions, and — the key new capability — **in-place selection and
bulk organization** (color label, add to album, download, delete) of the just-uploaded
photos, reusing the exact components and endpoints `/photos` already uses.

This is a UI/UX rebuild only. The upload API (`POST /api/uploads`), `handleUpload`, and
the ingest pipeline are unchanged.

## Non-goals (YAGNI)

- No changes to the upload API, `handleUpload`, ingest, hashing, or dedup logic.
- No server-generated thumbnails for in-flight tiles (we use client object URLs; the
  server thumbnail already exists for the photo once added, but we don't fetch it here).
- No per-tile "remove from this batch" affordance beyond what bulk Delete (trash) gives.
- No drag-to-reorder, no upload pause/cancel mid-flight, no retry of `unsupported`.
- No new sort control on the upload grid (capture dates aren't known client-side).

## Key facts the design relies on (verified)

- `POST /api/uploads` returns `UploadResult`:
  `{status:"added", id, path}` | `{status:"duplicate", id}` | `{status:"unsupported"}` |
  `{status:"error", message}`. **`added` and `duplicate` carry a real photo `id`.**
- Bulk-action endpoints all take id arrays and are page-agnostic:
  - Color label → `POST /api/photos/color-label { photoIds, label }`
  - Add to album → `<AddToAlbumDialog photoIds={string[]} open onOpenChange onAdded />`
  - Download → `downloadSelection(ids: string[])` from `@/lib/download-client`
  - Delete → `POST /api/photos/trash { ids }`
- Selection plumbing is generic: `useGridSelection()` →
  `{selectMode, selected:Set<string>, setSelected, enter, cancel, clear, count}`
  (owns Escape handling). `SelectionToolbar` and `HeaderBar` are shared.
- Grid controls are global singletons (shared with /photos, exactly like `album-view`):
  `useGridColumns()` → `{columns, setColumns}`, `useGridView()` → `{mode, setMode}`,
  rendered via `GridSizeMenu` / `GridViewMenu`. `COLUMNS_MIN=2 … COLUMNS_MAX=12`.
- `ColorLabelMenu({disabled, onPick})` is pure UI; parent applies the label.
- `SUPPORTED_EXTENSIONS` (`@lumio/shared`) = `.jpg .jpeg .png .webp .jxl .heic .heif`.
  `upload-collect.ts` already exposes `partitionSupported`, `collectFiles`, `isSupported`.
- `radix-ui` ^1.6.0 is installed → add a shadcn-style `ui/progress.tsx` on top of it.
- Standard page wrapper is `<main className="w-full px-6 pb-6">` (HeaderBar's `-mx-6/px-6`
  relies on the `px-6`). Upload's current `mx-auto max-w-3xl p-4` must change to match.

## Browser-previewable vs badge formats

```
PREVIEWABLE_EXTENSIONS = { .jpg, .jpeg, .png, .webp }   // <img src=objectURL> works
// everything else in SUPPORTED_EXTENSIONS → format-badge tile:
//   .jxl → "JXL",  .heic → "HEIC",  .heif → "HEIF"
```

A badge tile shows the uppercased extension (sans dot) + a small "preview after import"
caption. Live preview uses `URL.createObjectURL(file)`; object URLs are revoked on
clear/unmount to avoid leaks. Badge tiles allocate no object URL.

## Layout & states

Mockups (throwaway hand-rolled HTML, layout reference only) lived under
`.superpowers/brainstorm/.../content/`. **When building, use real shadcn components and
the app's existing components — no bespoke CSS where a component exists.**

Chosen layout = "collapsing drop zone" (mockup variant B).

**Header — three states (mirrors `library-view.tsx`, which swaps HeaderBar ⇄ SelectionToolbar):**

| State                        | Title        | Right-aligned actions                                            |
|------------------------------|--------------|------------------------------------------------------------------|
| Empty (no rows)              | "Upload"     | — (none)                                                          |
| Active (rows exist)          | "Upload"     | `GridViewMenu` · `GridSizeMenu` · **Select** button              |
| Select mode                  | "N selected" | `ColorLabelMenu` · **Add to album** · **Download** · **Delete** · **Cancel** |

- **Select** is enabled only when ≥1 selectable row exists (a row with a photo `id`).
- Select-mode actions are disabled when `count === 0` (same as /photos).

**Body (top → bottom):**

1. **Drop zone** (`UploadDropzone`)
   - *Empty state:* large hero — `UploadCloud` icon, "Drag photos or a folder here",
     inline `Browse files` / `Add a folder` links, and the format hint
     "JPEG · PNG · WebP · HEIC · HEIF · JXL".
   - *Active state:* collapses to a slim dashed bar — "**Drop more** here, browse files,
     or add a folder". Both states are drop targets (drag-over highlight).
2. **Command bar** (`UploadCommandBar`) — rendered only when rows exist. **Stays visible
   in select mode.**
   - *Uploading:* shadcn `Progress` (value = done/total) + "Uploading X of Y…".
   - *Done:* outcome counts as colored-dot chips — "N added · N duplicates · N failed ·
     N unsupported" (omit zero-count chips except always show "added"), plus
     **Retry failed** (re-uploads only error rows) and **View library →** (`/photos`).
   - `unsupported` is a **count only** here — no tile is rendered per unsupported file
     (a dropped folder of `.DS_Store`/text files must not flood the grid). Keeps the
     existing `skipped`-style behavior, surfaced as a chip.
3. **Tile grid** — density/view from the reused `GridSize`/`GridView` controls; one
   `UploadTile` per non-unsupported row.

## UploadTile

Square tile (aspect 1/1, rounded, bordered) + filename caption (mono, truncated).

- **Image** (`previewUrl`) for previewable formats, else a **format-badge** panel.
- **Status overlay:**
  - `uploading` → translucent scrim + spinner.
  - `added` → green check corner badge.
  - `duplicate` → amber corner badge (e.g. "already in library").
  - `error` → red scrim + "!" corner + inline **Retry** button (retries just this file).
  - (`unsupported` rows are not rendered as tiles.)
- **Selection (select mode only):** `added` and `duplicate` tiles (have a photo `id`)
  show a checkbox and a selected ring; clicking toggles membership in `sel.selected`.
  `uploading`/`error` tiles are not selectable. Match `PhotoGrid`'s selected-tile ring
  treatment for visual consistency.

## State model

`UploadClient` owns `rows: Row[]`:

```ts
type RowStatus = "queued" | "uploading" | "added" | "duplicate" | "error";
interface Row {
  id: number;          // client row id (existing nextRowId counter)
  file: File;          // RETAINED for Retry (today it's discarded)
  name: string;
  status: RowStatus;
  message?: string;
  photoId?: string;    // set for added | duplicate (from API result.id)
  previewUrl?: string; // object URL for previewable formats; revoked on clear/unmount
}
// `unsupported` is NOT a Row — counted separately as `unsupportedCount` (existing `skipped`).
```

- Concurrency pool stays (CONCURRENCY=3). `uploadOne` records `photoId` from the result.
- **Retry failed** / per-tile **Retry**: re-run `uploadOne` for the targeted error rows
  using the retained `File`.
- **Selectable ids:** `rows.filter(r => r.photoId).map(r => r.photoId!)`. Bulk actions
  operate on `sel.selected`.
- **Delete (trash) on upload page:** after a successful trash call, remove those rows
  from `rows` (our own list — there's no virtualized `PhotoGrid` here) and `sel.cancel()`.
- **Color label:** call the endpoint, toast success, `sel.clear()` (stay in select mode).
  Upload tiles don't render the color mat, so no optimistic patch is needed.
- **Add to album:** open `AddToAlbumDialog` with the selected ids; on `onAdded`, clear.
- **Download:** `downloadSelection([...sel.selected])`, then `sel.clear()`.
- **View library:** navigate to `/photos`.
- After each batch completes, `router.refresh()` stays (keeps server data fresh).

## Components

**Reuse (no new building):** `HeaderBar`, `SelectionToolbar`, `useGridSelection`,
`useGridColumns`, `useGridView`, `GridViewMenu`, `GridSizeMenu`, `ColorLabelMenu`,
`AddToAlbumDialog`, `downloadSelection`, `useConfirm`, `Button`, `cn`, and
`upload-collect` (`collectFiles`, `partitionSupported`).

**New:**

- `apps/web/src/components/ui/progress.tsx` — shadcn-style Progress over `radix-ui`.
- `apps/web/src/app/(app)/upload/upload-dropzone.tsx` — hero + slim variants, drag
  handling, hidden `<input>`s (files + `webkitdirectory`), browse/folder triggers.
- `apps/web/src/app/(app)/upload/upload-command-bar.tsx` — progress/summary/actions.
- `apps/web/src/app/(app)/upload/upload-tile.tsx` — tile + status overlay + selection.
- `apps/web/src/lib/upload-preview.ts` — `PREVIEWABLE_EXTENSIONS`, `isPreviewable(name)`,
  `formatBadge(name)` (uppercased ext). Unit-tested.
- Refactor `apps/web/src/app/(app)/upload/upload-client.tsx` — orchestrator: state,
  concurrency, retry, selection, header swap, bulk-action wiring, object-URL lifecycle.
- Update `apps/web/src/app/(app)/upload/page.tsx` — wrapper → `<main className="w-full
  px-6 pb-6">`; drop the bare `<h1>` (HeaderBar now owns the title).

## Edge cases

- **Dark mode:** use theme tokens (`bg-muted`, `text-muted-foreground`, `border`,
  `text-destructive`, etc.) and shadcn components so light/dark both work. Badge-tile
  background uses muted tokens, not hard-coded greys.
- **Folder drops with junk:** non-supported files counted as `unsupported`, never tiled.
- **Object URL leaks:** revoke on row removal, on clear, and on component unmount.
- **Duplicates are selectable** (they have a real `id`) so you can album/label an
  existing photo you re-dropped.
- **Empty → active transition:** drop zone collapses once the first row appears; header
  gains controls; command bar appears.
- **Retry** reuses the retained `File`; resets that row to `queued`→`uploading`.

## Testing

- Unit: `upload-preview.test.ts` (isPreviewable / formatBadge across the supported set
  incl. case-insensitivity and unknown ext).
- Keep/extend existing `upload-collect.test.ts` behavior (unchanged).
- Typecheck + lint + production build must pass.
- Browser verification (the project's dev-workflow norm): empty state, drag a mixed
  batch (previewable + heic/jxl + an unsupported `.txt`), watch progress → summary,
  trigger an error path if feasible + Retry, then Select → color/album/download/delete,
  and View library. Light + dark.

## Build approach

Single PR, built in ordered subagent tasks:

1. `ui/progress.tsx` + `upload-preview.ts` (+ test).
2. `UploadTile` (presentational).
3. `UploadDropzone` (presentational + inputs/drag).
4. `UploadCommandBar` (presentational).
5. `UploadClient` refactor + `page.tsx` wrapper (integration: state, selection, bulk
   actions, header swap).
6. Verify: typecheck, lint, build, tests, browser (light + dark).
