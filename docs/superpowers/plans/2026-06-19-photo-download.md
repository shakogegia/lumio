# Photo Download Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users download original photo files — a single original from the detail page, the selected set from the bulk toolbar (Library + Album), and a whole album from the album header — delivered as a bare file for one photo and a streamed ZIP for many.

**Architecture:** A single server-side zip core (`lib/download-service.ts`) builds a streaming, stored (uncompressed) `application/zip` `Response` from a list of photos. Two new routes feed it (`POST /api/photos/download` for an id list, `GET /api/albums/[id]/download` for a whole album), and the existing `GET /api/photos/[id]/original` route gains an opt-in `?download=1` attachment mode. A small client helper (`lib/download-client.ts`) wires toolbar buttons: a bare-file download for one selection, a `POST`→blob save for many. Album and single-file downloads use native anchors and stream straight to disk.

**Tech Stack:** Next.js 16 (App Router, node runtime), TypeScript, Prisma, `archiver` (new), Vitest, pnpm workspace (`@lumio/web`).

---

## File Structure

- **Create** `apps/web/src/lib/download-service.ts` — zip core + pure filename helpers (`dedupeEntryName`, `sanitizeZipName`, `attachmentDisposition`, `streamPhotosZip`).
- **Create** `apps/web/src/lib/download-service.test.ts` — unit tests for the pure helpers and the zip builder.
- **Create** `apps/web/src/lib/download-client.ts` — browser download helpers (`downloadFromUrl`, `downloadSelection`).
- **Create** `apps/web/src/app/api/photos/download/route.ts` — `POST` zip of an id list.
- **Create** `apps/web/src/app/api/albums/[id]/download/route.ts` — `GET` zip of a whole album.
- **Modify** `apps/web/src/app/api/photos/[id]/original/route.ts` — add `?download=1` attachment mode.
- **Modify** `apps/web/src/lib/photos-service.ts` — add `listPhotosForDownload(ids)`.
- **Modify** `apps/web/src/lib/albums-service.ts` — add `listAlbumPhotosForDownload(id)`.
- **Modify** `apps/web/src/app/(app)/photo/[id]/photo-detail.tsx` — Download button in the Info tab.
- **Modify** `apps/web/src/app/(app)/photos/library-view.tsx` — Download button in the selection toolbar.
- **Modify** `apps/web/src/app/(app)/albums/[id]/album-view.tsx` — Download in the album header + selection toolbar.
- **Modify** `apps/web/package.json` — add `archiver` + `@types/archiver`.

Routes and UI components follow the codebase convention of *not* having dedicated unit tests (services and pure helpers are tested; routes/components are verified by lint, typecheck, and manual browser checks).

---

## Task 1: Add the `archiver` dependency

**Files:**
- Modify: `apps/web/package.json`

- [ ] **Step 1: Install archiver and its types**

Run (from the repo root / worktree root):

```bash
pnpm --filter @lumio/web add archiver
pnpm --filter @lumio/web add -D @types/archiver
```

- [ ] **Step 2: Verify it landed in package.json**

Run: `grep -n "archiver" apps/web/package.json`
Expected: a `"archiver"` line under `dependencies` and `"@types/archiver"` under `devDependencies`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml
git commit -m "build(web): add archiver for photo zip downloads"
```

---

## Task 2: Pure filename helpers in `download-service.ts`

**Files:**
- Create: `apps/web/src/lib/download-service.ts`
- Test: `apps/web/src/lib/download-service.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/lib/download-service.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  attachmentDisposition,
  dedupeEntryName,
  sanitizeZipName,
} from "./download-service.js";

describe("dedupeEntryName", () => {
  it("returns the basename unchanged the first time", () => {
    const used = new Set<string>();
    expect(dedupeEntryName("a.jpg", used)).toBe("a.jpg");
    expect(used.has("a.jpg")).toBe(true);
  });

  it("suffixes collisions before the extension", () => {
    const used = new Set<string>();
    expect(dedupeEntryName("a.jpg", used)).toBe("a.jpg");
    expect(dedupeEntryName("a.jpg", used)).toBe("a (2).jpg");
    expect(dedupeEntryName("a.jpg", used)).toBe("a (3).jpg");
  });

  it("handles names without an extension", () => {
    const used = new Set<string>();
    expect(dedupeEntryName("README", used)).toBe("README");
    expect(dedupeEntryName("README", used)).toBe("README (2)");
  });
});

describe("sanitizeZipName", () => {
  it("keeps a clean name", () => {
    expect(sanitizeZipName("My Album")).toBe("My Album");
  });

  it("replaces path separators with dashes", () => {
    expect(sanitizeZipName("a/b\\c")).toBe("a-b-c");
  });

  it("strips reserved characters", () => {
    expect(sanitizeZipName('bad:"<>|?*name')).toBe("badname");
  });

  it("falls back to 'album' when empty or blank", () => {
    expect(sanitizeZipName("   ")).toBe("album");
    expect(sanitizeZipName("")).toBe("album");
  });
});

describe("attachmentDisposition", () => {
  it("builds an ascii filename plus a UTF-8 filename* parameter", () => {
    expect(attachmentDisposition("a.jpg")).toBe(
      "attachment; filename=\"a.jpg\"; filename*=UTF-8''a.jpg",
    );
  });

  it("downgrades non-ascii in the fallback and percent-encodes filename*", () => {
    const value = attachmentDisposition("café.jpg");
    expect(value).toContain('filename="caf_.jpg"');
    expect(value).toContain("filename*=UTF-8''caf%C3%A9.jpg");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @lumio/web test download-service`
Expected: FAIL — cannot resolve `./download-service.js` / exports not defined.

- [ ] **Step 3: Create the module with the three pure helpers**

Create `apps/web/src/lib/download-service.ts`:

```ts
/**
 * Build a download filename for an entry inside a zip. Entries are flattened to
 * their basename; collisions across source folders are de-duplicated with a
 * numeric suffix inserted before the extension (`a.jpg`, `a (2).jpg`, …).
 * Mutates `used` with the chosen name.
 */
export function dedupeEntryName(basename: string, used: Set<string>): string {
  if (!used.has(basename)) {
    used.add(basename);
    return basename;
  }
  const dot = basename.lastIndexOf(".");
  const stem = dot > 0 ? basename.slice(0, dot) : basename;
  const ext = dot > 0 ? basename.slice(dot) : "";
  let n = 2;
  let candidate = `${stem} (${n})${ext}`;
  while (used.has(candidate)) {
    n += 1;
    candidate = `${stem} (${n})${ext}`;
  }
  used.add(candidate);
  return candidate;
}

/**
 * Turn an album name into a safe zip filename (no path separators or reserved
 * characters), falling back to "album" when the result is empty. Does not
 * include the ".zip" extension — the caller appends it.
 */
export function sanitizeZipName(name: string): string {
  const cleaned = name
    .replace(/[/\\]/g, "-")
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x1f<>:"|?*]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
  return cleaned || "album";
}

/**
 * Build a `Content-Disposition: attachment` header value with an ASCII filename
 * fallback plus a UTF-8 `filename*` parameter (RFC 5987 / 6266), so unicode
 * names survive in modern browsers while older clients still get a usable name.
 */
export function attachmentDisposition(filename: string): string {
  // eslint-disable-next-line no-control-regex
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @lumio/web test download-service`
Expected: PASS — all three describe blocks green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/download-service.ts apps/web/src/lib/download-service.test.ts
git commit -m "feat(web): download filename helpers (dedupe, sanitize, disposition)"
```

---

## Task 3: `streamPhotosZip` zip builder

**Files:**
- Modify: `apps/web/src/lib/download-service.ts`
- Test: `apps/web/src/lib/download-service.test.ts`

- [ ] **Step 1: Add the failing test**

First, amend the existing `./download-service.js` import at the top of `apps/web/src/lib/download-service.test.ts` to include `streamPhotosZip` (keeps a single import statement, avoiding `no-duplicate-imports`):

```ts
import {
  attachmentDisposition,
  dedupeEntryName,
  sanitizeZipName,
  streamPhotosZip,
} from "./download-service.js";
```

Then add these Node imports below the existing `vitest` import at the top of the file:

```ts
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
```

Finally, append this describe block to the end of the file:

```ts
describe("streamPhotosZip", () => {
  it("zips the originals that exist and skips missing ones", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "lumio-dl-"));
    await writeFile(path.join(dir, "a.jpg"), "AAAA");
    await writeFile(path.join(dir, "b.jpg"), "BBBB");

    const res = streamPhotosZip(
      [
        { id: "1", path: "a.jpg" },
        { id: "2", path: "b.jpg" },
        { id: "3", path: "missing.jpg" },
      ],
      "test.zip",
      (rel) => path.join(dir, rel),
    );

    expect(res.headers.get("Content-Type")).toBe("application/zip");
    expect(res.headers.get("Content-Disposition")).toContain("test.zip");

    const buf = Buffer.from(await res.arrayBuffer());
    // Valid zip local-file-header magic.
    expect(buf.subarray(0, 2).toString("latin1")).toBe("PK");
    // Entry names are stored as plaintext in the zip; present files appear,
    // the missing one does not.
    expect(buf.includes(Buffer.from("a.jpg"))).toBe(true);
    expect(buf.includes(Buffer.from("b.jpg"))).toBe(true);
    expect(buf.includes(Buffer.from("missing.jpg"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @lumio/web test download-service`
Expected: FAIL — `streamPhotosZip` is not exported.

- [ ] **Step 3: Implement `streamPhotosZip`**

Add these imports to the top of `apps/web/src/lib/download-service.ts`:

```ts
import { existsSync } from "node:fs";
import { PassThrough, Readable } from "node:stream";
import archiver from "archiver";
import { originalPath } from "@/lib/paths";
```

Append to `apps/web/src/lib/download-service.ts`:

```ts
/**
 * Stream the given photos' originals as a single stored (uncompressed) zip.
 * Originals are already-compressed images, so storing avoids wasted CPU and
 * streams from disk with flat memory. `resolve` maps a photo's stored relative
 * path to an absolute path on disk (defaults to `originalPath`, the
 * traversal-guarded resolver; overridable for tests). Missing originals are
 * logged and skipped — never fatal.
 */
export function streamPhotosZip(
  photos: { id: string; path: string }[],
  zipName: string,
  resolve: (relPath: string) => string = originalPath,
): Response {
  const archive = archiver("zip", { store: true });
  const pass = new PassThrough();

  archive.on("warning", (err) => {
    console.warn("[download] zip warning:", err);
  });
  archive.on("error", (err) => {
    console.error("[download] zip error:", err);
    pass.destroy(err);
  });
  archive.pipe(pass);

  const used = new Set<string>();
  for (const photo of photos) {
    const abs = resolve(photo.path);
    if (!existsSync(abs)) {
      console.warn("[download] skipping missing original:", photo.path);
      continue;
    }
    const base = photo.path.split("/").pop() || photo.path;
    archive.file(abs, { name: dedupeEntryName(base, used), store: true });
  }
  void archive.finalize();

  return new Response(Readable.toWeb(pass) as unknown as ReadableStream<Uint8Array>, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": attachmentDisposition(zipName),
    },
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @lumio/web test download-service`
Expected: PASS — including the new `streamPhotosZip` block.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/download-service.ts apps/web/src/lib/download-service.test.ts
git commit -m "feat(web): streamPhotosZip — streamed stored zip of originals"
```

---

## Task 4: `?download=1` attachment mode on the original route

**Files:**
- Modify: `apps/web/src/app/api/photos/[id]/original/route.ts`

- [ ] **Step 1: Replace the route handler**

Replace the entire contents of `apps/web/src/app/api/photos/[id]/original/route.ts` with:

```ts
import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { getPhoto } from "@/lib/photos-service";
import { originalPath } from "@/lib/paths";
import { attachmentDisposition } from "@/lib/download-service";
import { withAuth } from "@/lib/with-auth";

export const runtime = "nodejs";

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export const GET = withAuth(
  async (request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const photo = await getPhoto(id);
    if (!photo) {
      return NextResponse.json({ error: "Photo not found" }, { status: 404 });
    }
    try {
      const file = await readFile(originalPath(photo.path));
      const ext = photo.path.slice(photo.path.lastIndexOf(".")).toLowerCase();
      const headers: Record<string, string> = {
        "Content-Type": CONTENT_TYPES[ext] ?? "application/octet-stream",
        "Cache-Control": "public, max-age=3600",
      };
      // Opt-in download mode: force a save with the original's filename.
      if (new URL(request.url).searchParams.get("download")) {
        const base = photo.path.split("/").pop() || photo.path;
        headers["Content-Disposition"] = attachmentDisposition(base);
      }
      return new NextResponse(new Uint8Array(file), { headers });
    } catch {
      return NextResponse.json({ error: "Original not found" }, { status: 404 });
    }
  },
);
```

- [ ] **Step 2: Lint the changed file**

Run: `pnpm --filter @lumio/web lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/api/photos/[id]/original/route.ts"
git commit -m "feat(web): ?download=1 attachment mode on original photo route"
```

---

## Task 5: `POST /api/photos/download` (zip an id list)

**Files:**
- Modify: `apps/web/src/lib/photos-service.ts`
- Create: `apps/web/src/app/api/photos/download/route.ts`

- [ ] **Step 1: Add `listPhotosForDownload` to photos-service**

In `apps/web/src/lib/photos-service.ts`, add this exported function (place it after `listPhotos`):

```ts
/** Minimal {id, path} for a set of photo ids, in canonical order, for zipping. */
export async function listPhotosForDownload(
  ids: string[],
  db: Db = prisma,
): Promise<{ id: string; path: string }[]> {
  return db.photo.findMany({
    where: { id: { in: ids } },
    orderBy: PHOTO_ORDER,
    select: { id: true, path: true },
  });
}
```

(`Db`, `prisma`, and `PHOTO_ORDER` are already imported in this file.)

- [ ] **Step 2: Create the route**

Create `apps/web/src/app/api/photos/download/route.ts`:

```ts
import { NextResponse } from "next/server";
import { photoIdsSchema } from "@lumio/shared";
import { listPhotosForDownload } from "@/lib/photos-service";
import { streamPhotosZip } from "@/lib/download-service";
import { withAuth } from "@/lib/with-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withAuth(async (request) => {
  const body: unknown = await request.json();
  const parsed = photoIdsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const photos = await listPhotosForDownload(parsed.data.ids);
  if (photos.length === 0) {
    return NextResponse.json({ error: "No photos found" }, { status: 404 });
  }
  return streamPhotosZip(photos, `lumio-photos-${photos.length}.zip`);
});
```

- [ ] **Step 3: Lint**

Run: `pnpm --filter @lumio/web lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/photos-service.ts apps/web/src/app/api/photos/download/route.ts
git commit -m "feat(web): POST /api/photos/download zips selected originals"
```

---

## Task 6: `GET /api/albums/[id]/download` (zip a whole album)

**Files:**
- Modify: `apps/web/src/lib/albums-service.ts`
- Create: `apps/web/src/app/api/albums/[id]/download/route.ts`

- [ ] **Step 1: Add `listAlbumPhotosForDownload` to albums-service**

In `apps/web/src/lib/albums-service.ts`, add this exported function (place it after `listAlbumPhotos`). It reuses the existing `albumPhotoWhere` so it works for both smart and regular albums:

```ts
/** Minimal {id, path} for every photo in an album (smart or regular), in
 *  canonical order, for zipping. Returns null when the album does not exist. */
export async function listAlbumPhotosForDownload(
  id: string,
  db: Db = prisma,
): Promise<{ id: string; path: string }[] | null> {
  const where = await albumPhotoWhere(id, db);
  if (where === null) return null;
  return db.photo.findMany({
    where,
    orderBy: PHOTO_ORDER,
    select: { id: true, path: true },
  });
}
```

(`Db`, `prisma`, `albumPhotoWhere`, and `PHOTO_ORDER` are already in this file.)

- [ ] **Step 2: Create the route**

Create `apps/web/src/app/api/albums/[id]/download/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getAlbum, listAlbumPhotosForDownload } from "@/lib/albums-service";
import { sanitizeZipName, streamPhotosZip } from "@/lib/download-service";
import { withAuth } from "@/lib/with-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(
  async (_request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const album = await getAlbum(id);
    if (!album) {
      return NextResponse.json({ error: "Album not found" }, { status: 404 });
    }
    const photos = await listAlbumPhotosForDownload(id);
    if (photos === null) {
      return NextResponse.json({ error: "Album not found" }, { status: 404 });
    }
    // An empty album streams a valid empty zip (no error page), so the header's
    // native-anchor download never lands the user on a JSON error.
    return streamPhotosZip(photos, `${sanitizeZipName(album.name)}.zip`);
  },
);
```

- [ ] **Step 3: Lint**

Run: `pnpm --filter @lumio/web lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/albums-service.ts "apps/web/src/app/api/albums/[id]/download/route.ts"
git commit -m "feat(web): GET /api/albums/[id]/download zips a whole album"
```

---

## Task 7: `download-client.ts` browser helpers

**Files:**
- Create: `apps/web/src/lib/download-client.ts`

- [ ] **Step 1: Create the module**

Create `apps/web/src/lib/download-client.ts`:

```ts
/** Trigger a browser download of a same-origin URL via a transient anchor.
 *  The server's Content-Disposition supplies the filename. */
export function downloadFromUrl(url: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * Download the selected photos: a bare original for one, a streamed zip for
 * many. The 2+ path POSTs the ids, reads the response as a blob, and saves it
 * via an object URL (blob URLs ignore Content-Disposition, so the filename is
 * set client-side). Throws on a failed request so callers can surface an error.
 */
export async function downloadSelection(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  if (ids.length === 1) {
    downloadFromUrl(`/api/photos/${ids[0]}/original?download=1`);
    return;
  }
  const res = await fetch("/api/photos/download", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) throw new Error("download failed");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = `lumio-photos-${ids.length}.zip`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}
```

- [ ] **Step 2: Lint**

Run: `pnpm --filter @lumio/web lint`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/download-client.ts
git commit -m "feat(web): client download helpers (single file + selection zip)"
```

---

## Task 8: Download button on the photo detail page

**Files:**
- Modify: `apps/web/src/app/(app)/photo/[id]/photo-detail.tsx`

- [ ] **Step 1: Add the `Download` icon to the lucide import**

In `apps/web/src/app/(app)/photo/[id]/photo-detail.tsx`, change:

```tsx
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
```

to:

```tsx
import { ChevronLeft, ChevronRight, Download, Search } from "lucide-react";
```

- [ ] **Step 2: Add the Download button above Delete in the Info tab**

In the same file, find this block inside `<TabsContent value="info" …>`:

```tsx
            <Separator />
            <DeletePhotoButton photoId={photo.id} />
```

Replace it with:

```tsx
            <Separator />
            <div className="space-y-2">
              <Button asChild variant="outline" size="sm" className="w-full">
                <a href={`/api/photos/${photo.id}/original?download=1`}>
                  <Download aria-hidden />
                  Download
                </a>
              </Button>
              <DeletePhotoButton photoId={photo.id} />
            </div>
```

(`Button` is already imported in this file.)

- [ ] **Step 3: Lint**

Run: `pnpm --filter @lumio/web lint`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/(app)/photo/[id]/photo-detail.tsx"
git commit -m "feat(web): Download button on photo detail page"
```

---

## Task 9: Download button in the Library selection toolbar

**Files:**
- Modify: `apps/web/src/app/(app)/photos/library-view.tsx`

- [ ] **Step 1: Add imports**

In `apps/web/src/app/(app)/photos/library-view.tsx`, add these two imports alongside the existing imports (after the `toast` import is fine):

```tsx
import { Download } from "lucide-react";
import { downloadSelection } from "@/lib/download-client";
```

- [ ] **Step 2: Add a `downloading` state**

Next to the other `useState` calls in `LibraryView` (e.g. after `const [deleting, setDeleting] = useState(false);`), add:

```tsx
  const [downloading, setDownloading] = useState(false);
```

- [ ] **Step 3: Add the download handler**

Inside `LibraryView`, after `handleDelete`, add:

```tsx
  async function handleDownload() {
    const ids = [...sel.selected];
    if (ids.length === 0 || downloading) return;
    setDownloading(true);
    try {
      await downloadSelection(ids);
    } catch {
      toast.error("Failed to download photos.");
    } finally {
      setDownloading(false);
    }
  }
```

- [ ] **Step 4: Add the Download button to the toolbar actions**

In the `<SelectionToolbar … actions={…}>` block, add this button immediately before the destructive Delete `<Button>`:

```tsx
              <Button
                variant="outline"
                size="sm"
                disabled={sel.count === 0 || downloading}
                onClick={() => void handleDownload()}
              >
                <Download aria-hidden />
                {downloading ? "Preparing…" : "Download"}
              </Button>
```

- [ ] **Step 5: Lint**

Run: `pnpm --filter @lumio/web lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/(app)/photos/library-view.tsx"
git commit -m "feat(web): Download button in Library selection toolbar"
```

---

## Task 10: Download in the Album header + selection toolbar

**Files:**
- Modify: `apps/web/src/app/(app)/albums/[id]/album-view.tsx`

- [ ] **Step 1: Add imports**

In `apps/web/src/app/(app)/albums/[id]/album-view.tsx`, change the lucide import:

```tsx
import { Images } from "lucide-react";
```

to:

```tsx
import { Download, Images } from "lucide-react";
```

And add, alongside the other `@/lib` imports:

```tsx
import { downloadSelection } from "@/lib/download-client";
```

- [ ] **Step 2: Add a `downloading` state**

Next to the other `useState` calls in `AlbumView` (e.g. after `const [deleting, setDeleting] = useState(false);`), add:

```tsx
  const [downloading, setDownloading] = useState(false);
```

- [ ] **Step 3: Add the selection download handler**

Inside `AlbumView`, after `handleDelete`, add:

```tsx
  async function handleDownload() {
    const ids = [...sel.selected];
    if (ids.length === 0 || downloading) return;
    setDownloading(true);
    try {
      await downloadSelection(ids);
    } catch {
      toast.error("Failed to download photos.");
    } finally {
      setDownloading(false);
    }
  }
```

- [ ] **Step 4: Add the Download button to the selection toolbar**

In the `<SelectionToolbar … actions={…}>` block, add this button immediately before the final destructive Delete `<Button>`:

```tsx
              <Button
                variant="outline"
                size="sm"
                disabled={sel.count === 0 || downloading}
                onClick={() => void handleDownload()}
              >
                <Download aria-hidden />
                {downloading ? "Preparing…" : "Download"}
              </Button>
```

- [ ] **Step 5: Add the whole-album Download button to the normal header**

In the non-select `<HeaderBar … actions={…}>` block, add this button immediately before `<DeleteAlbumButton albumId={albumId} />`:

```tsx
              <Button asChild variant="outline" size="sm">
                <a href={`/api/albums/${albumId}/download`}>
                  <Download aria-hidden />
                  Download
                </a>
              </Button>
```

- [ ] **Step 6: Lint**

Run: `pnpm --filter @lumio/web lint`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add "apps/web/src/app/(app)/albums/[id]/album-view.tsx"
git commit -m "feat(web): Download album (header) + selection download in Album view"
```

---

## Task 11: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `pnpm --filter @lumio/web test`
Expected: PASS — all suites, including `download-service`.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: no type errors. (If the project lacks a standalone tsc setup, fall back to `pnpm --filter @lumio/web build` as the type/compile gate.)

- [ ] **Step 3: Lint the whole app**

Run: `pnpm --filter @lumio/web lint`
Expected: no errors.

- [ ] **Step 4: Manual browser checklist**

Start the app (`pnpm --filter @lumio/web dev`) and verify, ideally with at least one smart album, one regular album, and photos whose originals share a basename across folders:

- Photo detail (standalone page **and** modal overlay): **Download** saves the original with its real filename and extension.
- Library → Select → pick **1** photo → **Download** → the bare original downloads.
- Library → Select → pick **3** photos → **Download** → `lumio-photos-3.zip` downloads and contains 3 files; the button shows "Preparing…" while it works.
- Album header **Download** → `<album name>.zip` downloads with every photo — test on a **smart** album and a **regular** album.
- Album → Select → subset → **Download** → a zip of just the subset.
- Confirm collision handling: a zip with two same-named originals contains `name.jpg` and `name (2).jpg`.
- Force a failure (e.g. stop the server mid-request) → an error toast appears for the bulk download.

- [ ] **Step 5: Commit (if any verification fixes were needed)**

```bash
git add -A
git commit -m "test(web): verify photo download end to end"
```

---

## Self-Review Notes

- **Spec coverage:** originals only (Tasks 4/5/6 stream from `originalPath`); single→bare file (Task 4 + client Task 7); 2+→zip (Tasks 3/5/7/9/10); album→zip incl. smart (Task 6 via `albumPhotoWhere`); flatten+dedupe (Task 2/3); `archiver` stored (Tasks 1/3); known buffering tradeoff lives entirely in the selection path (Task 7) while album uses native GET (Tasks 6/10); empty album → empty zip (Task 6). All spec sections map to a task.
- **Type consistency:** `streamPhotosZip(photos, zipName, resolve?)`, `dedupeEntryName(basename, used)`, `sanitizeZipName(name)`, `attachmentDisposition(filename)`, `listPhotosForDownload(ids)`, `listAlbumPhotosForDownload(id)`, `downloadFromUrl(url)`, `downloadSelection(ids)` are referenced with identical signatures across tasks.
- **No placeholders:** every code step shows complete code.
