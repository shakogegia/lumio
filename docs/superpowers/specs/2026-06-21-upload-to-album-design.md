# Upload directly into an album

## Problem

From an album view, there's no way to add new photos to that album in one flow.
Today you upload on `/upload`, then go back, select the uploaded tiles, and use the
"Add to album" dropdown — a tedious, easy-to-forget post-upload step. We want an
upload entry point on the album page that drops you on the upload page with that
album already chosen, so every photo you upload there lands in the album
automatically.

## Goal

- Add an **upload button** to the album view header that links to the upload page
  scoped to that album.
- On the upload page, when scoped to an album, **automatically add every
  successfully-uploaded photo to that album** — no manual selection step.
- Make it visually clear on the upload page which album uploads are flowing into.

## Non-goals

- No change to the manual "Add to album" selection toolbar (it stays, unchanged).
- No new upload API; auto-add reuses the existing `POST /api/albums/[id]/photos`.
- Smart albums are out of scope — their membership is rule-derived and can't take
  manually-added photos.

## Design

### 1. Entry point — upload button in the album header

In `apps/web/src/app/(app)/albums/[id]/album-view.tsx`, in the non-selection
`HeaderBar` `actions` (next to the existing "Download album" button), add an upload
icon button — rendered **only when `!isSmart`**:

```tsx
<Button asChild variant="outline" size="icon-sm"
        aria-label="Upload to this album" title="Upload to this album">
  <a href={`/upload?albumId=${albumId}`}><Upload aria-hidden /></a>
</Button>
```

- Icon: lucide `Upload` (`ImageUp` is already used for "Set as album cover").
- It's a normal link/navigation — no client state to thread.

### 2. Upload page resolves the target album (server-side)

`apps/web/src/app/(app)/upload/page.tsx` becomes `async` and reads
`searchParams.albumId`:

- If present, call `getAlbum(id)` (from `@/lib/albums-service`).
- If the album exists **and** `!isSmart`, pass
  `targetAlbum={{ id: album.id, name: album.name }}` to `UploadClient`.
- Otherwise (missing param, unknown id, or smart album), render a normal upload
  page — `targetAlbum` undefined. Graceful fallback; no error.

Resolving the album **name** server-side keeps it out of the URL and never stale.

Next.js note: `searchParams` is a `Promise` in this app's Next version (matches the
`params: Promise<…>` usage in `albums/[id]/page.tsx`); await it.

### 3. Auto-add in `UploadClient`

`apps/web/src/app/(app)/upload/upload-client.tsx` takes an optional
`targetAlbum?: { id: string; name: string }`.

- **Banner:** when `targetAlbum` is set, render a small banner beneath the header —
  e.g. *"Uploading to ‹Album name›"* — so the destination is obvious. Placed in the
  `space-y-6` content block above the dropzone.
- **Auto-add:** in `runPool`, after the batch's worker pool resolves, collect the
  `photoId` of every row in the batch that finished with one (status `added` **or**
  `duplicate`). If `targetAlbum` is set and the list is non-empty, POST them in a
  single call:

  ```ts
  await fetch(`/api/albums/${targetAlbum.id}/photos`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ photoIds }),
  });
  ```

  - Fires per batch, so repeated drops keep flowing into the album.
  - Reuse the photoIds already returned by `uploadOne` (each row's `photoId`); the
    pool already knows each upload's result, so collect ids there rather than
    re-reading state.
  - **Quiet on success:** we already chime `SoundEffect.ActionComplete` once per
    batch and call `router.refresh()` in `runPool`. The auto-add must not add a
    second chime or a second refresh — do the POST inline before/within the
    existing refresh path, not via `addToAlbumDirect` (which chimes + refreshes).
  - On failure, `toast.error("Failed to add photos to the album.")`. Upload itself
    still succeeded; only the album link failed.

### Duplicate handling

Photos that re-upload as `duplicate` carry the existing library photo's `id`. These
**are** added to the album — intent is "these belong in this album" regardless of
whether the bytes were already stored. The album-add is idempotent (the
`albumPhoto` table is keyed on `(albumId, photoId)`; the endpoint must skip
duplicates), so re-adding an existing member is a no-op. Verify the endpoint is
idempotent during implementation.

## Data flow

```
Album view (!isSmart)
  └─ "Upload to this album" link → /upload?albumId=<id>
       └─ upload/page.tsx (server): getAlbum(id), drop if missing/smart
            └─ <UploadClient targetAlbum={{id, name}} />
                 ├─ banner: "Uploading to <name>"
                 └─ runPool(): upload files → collect added|duplicate photoIds
                      └─ POST /api/albums/<id>/photos { photoIds }  (quiet)
```

## Edge cases

- **Unknown / deleted album id in URL** → fallback to normal upload (no error).
- **Smart album id in URL** → fallback to normal upload (button never offered for
  smart albums, but guard the page too).
- **All uploads failed / all unsupported** → no photoIds, no album POST.
- **Album-add POST fails** → toast error; uploaded photos remain in the library.

## Testing

- Unit: the photoId-collection logic in `runPool` (added + duplicate included,
  errors excluded) — extract if it eases testing.
- Manual / browser verify:
  - Album header (non-smart) shows the upload button; smart album does not.
  - Clicking it lands on `/upload?albumId=…` with the banner naming the album.
  - Dropping files adds them to the album (verify album photo count / membership).
  - A duplicate re-upload still lands in the album.
  - Visiting `/upload` with no/garbage `albumId` behaves like today (no banner,
    no auto-add).
