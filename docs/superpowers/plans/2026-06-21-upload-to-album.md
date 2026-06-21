# Upload directly into an album — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** From an album view, an upload button takes you to the upload page scoped to that album, where every photo you upload is added to the album automatically.

**Architecture:** A link on the album header (`/upload?albumId=<id>`) → the upload server page resolves the album server-side and passes `{id, name}` to `UploadClient` → `UploadClient` shows a "Uploading to ‹name›" banner and, after each upload batch, POSTs the batch's resolved photo ids to the existing `POST /api/albums/[id]/photos`. The membership write is idempotent (`createMany({ skipDuplicates: true })`).

**Tech Stack:** Next.js (App Router, async server components, `searchParams: Promise`), React client components, lucide-react icons, vitest, Prisma.

**Spec:** `docs/superpowers/specs/2026-06-21-upload-to-album-design.md`

---

## File structure

- **Modify** `apps/web/src/lib/upload-rows.ts` — add the pure `albumTargetIds()` helper.
- **Modify** `apps/web/src/lib/upload-rows.test.ts` — tests for `albumTargetIds()`.
- **Modify** `apps/web/src/app/(app)/albums/[id]/album-view.tsx` — add the "Upload to this album" header button (non-smart only).
- **Modify** `apps/web/src/app/(app)/upload/upload-client.tsx` — `targetAlbum` prop, banner, auto-add in `runPool` (and `uploadOne` returns its `photoId`).
- **Modify** `apps/web/src/app/(app)/upload/page.tsx` — async; resolve `targetAlbum` from `searchParams.albumId`.

Commands assume repo root. Single test file:
`pnpm --filter @lumio/web test <path>`. Lint: `pnpm --filter @lumio/web lint`.

---

## Task 1: `albumTargetIds` helper (the batch → album-ids rule)

**Files:**
- Modify: `apps/web/src/lib/upload-rows.ts`
- Test: `apps/web/src/lib/upload-rows.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `apps/web/src/lib/upload-rows.test.ts`. Update the existing import on line 2 to include the new symbol:

```ts
import { albumTargetIds, selectableIds, summarizeRows, type Row } from "./upload-rows";
```

Then add at the end of the file:

```ts
describe("albumTargetIds", () => {
  it("collects added and duplicate ids, skipping errors and missing ids", () => {
    expect(
      albumTargetIds([
        { status: "added", photoId: "a" },
        { status: "duplicate", photoId: "b" },
        { status: "error" },
        { status: "added" }, // resolved without an id — defensively skipped
      ]),
    ).toEqual(["a", "b"]);
  });

  it("is empty for an all-failed batch", () => {
    expect(albumTargetIds([{ status: "error" }, { status: "error" }])).toEqual([]);
  });

  it("is empty for an empty batch", () => {
    expect(albumTargetIds([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @lumio/web test src/lib/upload-rows.test.ts`
Expected: FAIL — `albumTargetIds is not exported` / `is not a function`.

- [ ] **Step 3: Add the helper**

Append to `apps/web/src/lib/upload-rows.ts` (after `selectableIds`):

```ts
/** From a batch's upload results, the photo ids to auto-add to a target album:
 * every upload that resolved to a real photo — newly stored (`added`) or an
 * existing library photo (`duplicate`). Errors and id-less results contribute
 * nothing. The album write is idempotent, so `duplicate` re-adds are no-ops. */
export function albumTargetIds(
  results: Array<{ status: RowStatus; photoId?: string }>,
): string[] {
  return results
    .filter((r) => (r.status === "added" || r.status === "duplicate") && r.photoId)
    .map((r) => r.photoId as string);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @lumio/web test src/lib/upload-rows.test.ts`
Expected: PASS (all `albumTargetIds` cases plus the pre-existing `summarizeRows`/`selectableIds` suites).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/upload-rows.ts apps/web/src/lib/upload-rows.test.ts
git commit -m "feat(web): albumTargetIds helper for auto-adding uploads to an album"
```

---

## Task 2: Upload button in the album header

**Files:**
- Modify: `apps/web/src/app/(app)/albums/[id]/album-view.tsx`

- [ ] **Step 1: Import the `Upload` icon**

Replace the lucide import on line 5:

```ts
import { Download, FolderMinus, Images, ImageUp, Loader2, Trash2 } from "lucide-react";
```

with:

```ts
import { Download, FolderMinus, Images, ImageUp, Loader2, Trash2, Upload } from "lucide-react";
```

- [ ] **Step 2: Add the button to the non-selection header actions**

In the `else` branch's `HeaderBar` (the `actions` prop, currently ending with the "Download album" button), insert the upload button immediately **before** the existing Download-album `<Button>`. The block becomes:

```tsx
actions={
  <>
    <GridViewMenu mode={mode} onModeChange={setMode} />
    <GridSizeMenu columns={columns} onColumnsChange={setColumns} />
    <GridSortMenu sort={sort} onSortChange={setSort} />
    <GridCalendarMenu
      facetsEndpoint={`/api/albums/${albumId}/calendar`}
      value={month}
      onChange={setMonth}
    />
    {!isSmart && (
      <Button asChild variant="outline" size="icon-sm" aria-label="Upload to this album" title="Upload to this album">
        <a href={`/upload?albumId=${albumId}`}>
          <Upload aria-hidden />
        </a>
      </Button>
    )}
    <Button asChild variant="outline" size="icon-sm" aria-label="Download album" title="Download album">
      <a href={`/api/albums/${albumId}/download`}>
        <Download aria-hidden />
      </a>
    </Button>
  </>
}
```

Rationale for `!isSmart`: smart albums derive membership from rules and reject manual adds (`SmartAlbumMutationError`), so offering an upload-into-it button would be a dead end.

- [ ] **Step 3: Lint**

Run: `pnpm --filter @lumio/web lint`
Expected: no new errors for `album-view.tsx`.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/(app)/albums/[id]/album-view.tsx"
git commit -m "feat(web): add Upload-to-this-album button to album header (non-smart)"
```

---

## Task 3: `UploadClient` — target-album prop, banner, auto-add

**Files:**
- Modify: `apps/web/src/app/(app)/upload/upload-client.tsx`

- [ ] **Step 1: Import `FolderPlus` and the helper**

Update the lucide import on line 6:

```ts
import { Download, FolderPlus, Loader2, Trash2 } from "lucide-react";
```

Update the `upload-rows` import on line 19 to add `albumTargetIds`:

```ts
import { albumTargetIds, summarizeRows, type Row, type RowStatus } from "@/lib/upload-rows";
```

- [ ] **Step 2: Accept the `targetAlbum` prop**

Change the component signature (line 33):

```ts
export function UploadClient({
  targetAlbum,
}: {
  targetAlbum?: { id: string; name: string };
}) {
```

- [ ] **Step 3: Return the photoId from `uploadOne`**

Replace the whole `uploadOne` callback (lines 50–72) so it returns the resolved id alongside the status:

```ts
const uploadOne = useCallback(
  async (file: File, rowId: number): Promise<{ status: RowStatus; photoId?: string }> => {
    update(rowId, { status: "uploading", message: undefined });
    const body = new FormData();
    body.set("file", file);
    body.set("lastModified", String(file.lastModified));
    try {
      const res = await fetch("/api/uploads", { method: "POST", body });
      const data: UploadResponse = await res.json();
      if (data.status === "unsupported") {
        // Pre-filtered client-side; a late unsupported is treated as a failure.
        update(rowId, { status: "error", message: "Unsupported format" });
        return { status: "error" };
      }
      update(rowId, { status: data.status, message: data.message, photoId: data.id });
      return { status: data.status, photoId: data.id };
    } catch (err) {
      update(rowId, { status: "error", message: (err as Error).message });
      return { status: "error" };
    }
  },
  [update],
);
```

- [ ] **Step 4: Auto-add the batch in `runPool`**

Replace the whole `runPool` callback (lines 75–93) with the version below. It collects each worker's result, adds this batch's resolved photos to the target album (quietly), then preserves the existing single chime + single refresh:

```ts
// Bounded-concurrency worker pool shared by initial uploads and retries.
const runPool = useCallback(
  async (queued: Array<{ file: File; rowId: number }>) => {
    if (queued.length === 0) return;
    let cursor = 0;
    const results: Array<{ status: RowStatus; photoId?: string }> = [];
    async function worker() {
      while (cursor < queued.length) {
        const item = queued[cursor++];
        if (item) results.push(await uploadOne(item.file, item.rowId));
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queued.length) }, worker));
    // When the upload page is scoped to an album, add this batch's resolved
    // photos (newly stored or pre-existing duplicates) to it. Idempotent server
    // side. Quiet on success — the upload chime + refresh below cover the batch.
    if (targetAlbum) {
      const ids = albumTargetIds(results);
      if (ids.length > 0) {
        try {
          const res = await fetch(`/api/albums/${targetAlbum.id}/photos`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ photoIds: ids }),
          });
          if (!res.ok) throw new Error("add failed");
        } catch {
          toast.error("Failed to add photos to the album.");
        }
      }
    }
    // Chime once per batch when at least one genuinely new photo landed
    // (not for all-duplicate/all-failed batches). Respects the sound setting.
    if (results.some((r) => r.status === "added")) playSound(SoundEffect.ActionComplete);
    router.refresh();
  },
  [router, targetAlbum, uploadOne],
);
```

- [ ] **Step 5: Render the banner**

Inside the content block, add the banner as the first child of `<div className="space-y-6 pt-2">` (currently line 287), directly above `<UploadDropzone …>`:

```tsx
<div className="space-y-6 pt-2">
  {targetAlbum ? (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <FolderPlus className="size-4" aria-hidden />
      <span>
        Uploading to <span className="font-medium text-foreground">{targetAlbum.name}</span>
      </span>
    </div>
  ) : null}
  <UploadDropzone variant={hasRows ? "slim" : "hero"} onFiles={(f) => void addFiles(f)} />
```

- [ ] **Step 6: Lint**

Run: `pnpm --filter @lumio/web lint`
Expected: no new errors for `upload-client.tsx`. In particular, confirm the React-Compiler ESLint rules pass (the new `targetAlbum` dep is added to `runPool`'s dependency array).

- [ ] **Step 7: Run the helper test again (still green)**

Run: `pnpm --filter @lumio/web test src/lib/upload-rows.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add "apps/web/src/app/(app)/upload/upload-client.tsx"
git commit -m "feat(web): auto-add uploads to a target album with a destination banner"
```

---

## Task 4: Upload page resolves the target album

**Files:**
- Modify: `apps/web/src/app/(app)/upload/page.tsx`

- [ ] **Step 1: Make the page async and resolve the album**

Replace the entire file with:

```tsx
import type { Metadata } from "next";
import { getAlbum } from "@/lib/albums-service";
import { UploadClient } from "./upload-client";

export const metadata: Metadata = { title: "Upload" };

export default async function UploadPage({
  searchParams,
}: {
  searchParams: Promise<{ albumId?: string | string[] }>;
}) {
  const { albumId } = await searchParams;
  const id = Array.isArray(albumId) ? albumId[0] : albumId;

  // Resolve the destination album server-side: keeps its name out of the URL
  // and never stale. Unknown ids and smart albums fall back to a plain upload.
  let targetAlbum: { id: string; name: string } | undefined;
  if (id) {
    const album = await getAlbum(id);
    if (album && !album.isSmart) {
      targetAlbum = { id: album.id, name: album.name };
    }
  }

  return (
    <main className="w-full px-4 pb-6">
      <UploadClient targetAlbum={targetAlbum} />
    </main>
  );
}
```

- [ ] **Step 2: Lint**

Run: `pnpm --filter @lumio/web lint`
Expected: no new errors for `upload/page.tsx`.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/(app)/upload/page.tsx"
git commit -m "feat(web): scope the upload page to ?albumId for auto-add"
```

---

## Task 5: End-to-end verification (browser)

**Files:** none (manual verification).

Prereqs (see project env notes): Postgres reachable (port 5433), then start the web app:
`pnpm --filter @lumio/web dev` (runs `next dev --webpack`).

- [ ] **Step 1: Album header shows the button (non-smart)**

Open a normal album at `/albums/<id>`. Confirm an Upload (up-arrow tray) icon button appears in the header next to "Download album", with tooltip "Upload to this album".

- [ ] **Step 2: Smart album hides the button**

Open a smart album. Confirm the Upload button is **absent** (Download album still present).

- [ ] **Step 3: Link + banner**

Click the Upload button. Confirm the URL is `/upload?albumId=<id>` and a banner reads "Uploading to ‹album name›".

- [ ] **Step 4: Auto-add on upload**

Drop one or more new image files. After they finish, navigate back to `/albums/<id>` and confirm the photos are now members (count increased / tiles present). No second chime beyond the normal upload cue.

- [ ] **Step 5: Duplicate re-upload still lands in the album**

Upload a file whose photo already exists in the library (status shows `duplicate`). Confirm it is present in the album afterward.

- [ ] **Step 6: Graceful fallback**

Visit `/upload` (no param) and `/upload?albumId=does-not-exist`. Confirm: no banner, normal upload behavior, and uploads are **not** auto-added to any album. Confirm console/network shows no failed `/api/albums/.../photos` calls.

- [ ] **Step 7: Final full test + lint pass**

Run: `pnpm --filter @lumio/web test src/lib/upload-rows.test.ts`
Run: `pnpm --filter @lumio/web lint`
Expected: both green for touched files.

---

## Self-review notes

- **Spec coverage:** header button non-smart (Task 2) ✓; server-side album resolve + fallback (Task 4) ✓; banner (Task 3 Step 5) ✓; auto-add added+duplicate, quiet, single refresh/chime (Task 1 + Task 3 Step 4) ✓; idempotency relied upon and confirmed via `skipDuplicates` ✓; tests + browser verify (Task 1, Task 5) ✓.
- **Type consistency:** `albumTargetIds(Array<{status: RowStatus; photoId?: string}>)` is exactly the shape `uploadOne` now returns and `runPool` collects; `targetAlbum: { id: string; name: string }` is identical across `page.tsx`, `UploadClient` props, and the fetch/banner usages.
- **No placeholders:** every code step shows complete code; no TBD/TODO.
