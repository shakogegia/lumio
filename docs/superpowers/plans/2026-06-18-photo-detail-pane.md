# Photo Detail Right-Side Pane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the slide-out details `Sheet` on the photo detail page with a persistent pane to the right of the image (stacking below on narrow screens).

**Architecture:** Pure presentational refactor of one client component (`photo-detail.tsx`) into a responsive two-column flex layout, plus a one-line wrapper width bump in the two pages that render it. No data-layer, API, routing, or album-mutation-logic changes. The album checkbox list (`AlbumMembership`) keeps its existing behavior; only its sheet-specific outer wrapper classes change so it aligns inside the pane.

**Tech Stack:** Next.js (App Router), React client component, Tailwind CSS, shadcn/ui (`Badge`, `Separator`), native `<details>` for the EXIF disclosure.

**Verification note:** `@lumio/web` has no React component-test infrastructure (all `vitest` tests are pure `lib/` logic). This is a layout-only change with no logic, so it is verified by lint + build + browser, consistent with the project's pattern. There are no new unit tests.

---

### Task 1: Rebuild `photo-detail.tsx` as a two-column pane

**Files:**
- Modify (full rewrite): `apps/web/src/app/(app)/photo/[id]/photo-detail.tsx`

- [ ] **Step 1: Replace the file contents**

Replace the entire contents of `apps/web/src/app/(app)/photo/[id]/photo-detail.tsx` with:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AlbumSummaryDTO, PhotoDTO } from "@lumio/shared";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

export function PhotoDetail({
  photo,
  regularAlbums,
}: {
  photo: PhotoDTO;
  regularAlbums: AlbumSummaryDTO[];
}) {
  const filename = photo.path.split("/").pop() || photo.path;
  const camera =
    [photo.exif.cameraMake, photo.exif.cameraModel].filter(Boolean).join(" ") ||
    "—";

  return (
    <div className="flex flex-col gap-6 lg:flex-row">
      <div className="min-w-0 flex-1">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/photos/${photo.id}/display`}
          alt={photo.path}
          className="max-h-[80vh] w-full rounded-lg object-contain"
        />
      </div>
      <aside className="w-full shrink-0 rounded-lg border bg-card p-4 text-sm lg:w-80">
        <div className="space-y-1">
          <h2 className="font-medium break-all">{filename}</h2>
          <div className="flex items-center gap-2">
            <Badge>{photo.source}</Badge>
            <span className="text-muted-foreground">
              {photo.width}×{photo.height}
            </span>
          </div>
        </div>

        <Separator className="my-4" />

        <div className="space-y-3">
          <Row label="Taken" value={photo.takenAt ?? "—"} />
          <Row label="Camera" value={camera} />
          <Row label="Hash" value={photo.hash ?? "—"} />
        </div>

        {regularAlbums.length > 0 && (
          <>
            <Separator className="my-4" />
            <AlbumMembership photo={photo} regularAlbums={regularAlbums} />
          </>
        )}

        <Separator className="my-4" />

        <details className="group">
          <summary className="cursor-pointer text-muted-foreground select-none">
            Show all EXIF
          </summary>
          <pre className="mt-2 overflow-auto rounded bg-muted p-2 text-xs">
            {JSON.stringify(photo.exif, null, 2)}
          </pre>
        </details>
      </aside>
    </div>
  );
}

function AlbumMembership({
  photo,
  regularAlbums,
}: {
  photo: PhotoDTO;
  regularAlbums: AlbumSummaryDTO[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);

  async function toggle(album: AlbumSummaryDTO) {
    const isMember = photo.albumIds?.includes(album.id) ?? false;
    setPending(album.id);
    try {
      if (isMember) {
        await fetch(`/api/albums/${album.id}/photos/${photo.id}`, {
          method: "DELETE",
        });
      } else {
        await fetch(`/api/albums/${album.id}/photos`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ photoId: photo.id }),
        });
      }
      router.refresh();
    } finally {
      setPending(null);
    }
  }

  return (
    <div>
      <p className="mb-2 font-medium">Albums</p>
      <div className="space-y-2">
        {regularAlbums.map((album) => {
          const checked = photo.albumIds?.includes(album.id) ?? false;
          return (
            <label
              key={album.id}
              className="flex cursor-pointer items-center gap-2"
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={pending !== null}
                onChange={() => void toggle(album)}
                className="h-4 w-4 rounded border-input accent-primary"
              />
              <span>{album.name}</span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate text-right">{value}</span>
    </div>
  );
}
```

What changed vs. the old file:
- Removed all `Sheet*` imports, the `open` state, the `SheetTrigger` "Details" button, and the `Sheet`/`SheetContent` wrapper.
- Added `Separator` import; root is now `flex flex-col gap-6 lg:flex-row` with the image in a `min-w-0 flex-1` column and the details in a `w-full shrink-0 lg:w-80` `<aside>`.
- Added a filename header (`basename` of `photo.path`) and a combined `Camera` value (`cameraMake` + `cameraModel`).
- Moved the raw EXIF `<pre>` into a collapsed native `<details>` ("Show all EXIF").
- `AlbumMembership`'s toggle logic and checkbox markup are unchanged; only its outer wrapper changed from `border-t px-4 pt-4 pb-4` to a plain `<div>` (the parent `<Separator>` now divides it) and the redundant per-element `text-sm` classes were dropped (inherited from the `<aside>`).

- [ ] **Step 2: Lint**

Run: `pnpm --filter @lumio/web lint`
Expected: PASS, no errors for `photo-detail.tsx` (no unused `Sheet`/`Button`/`useState` import warnings — `useState`/`useRouter` are still used by `AlbumMembership`).

- [ ] **Step 3: Build (type-check)**

Run: `pnpm --filter @lumio/web build`
Expected: PASS — compiles with no type errors. (Next build performs type-checking; there is no separate `tsc` script.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/\(app\)/photo/\[id\]/photo-detail.tsx
git commit -m "feat(web): show photo details in a right-side pane instead of a sheet"
```

---

### Task 2: Widen the page wrappers

**Files:**
- Modify: `apps/web/src/app/(app)/photo/[id]/page.tsx` (the `<main>` className)
- Modify: `apps/web/src/app/(app)/@modal/(.)photo/[id]/page.tsx` (the `<main>` className)

- [ ] **Step 1: Bump the standalone page wrapper**

In `apps/web/src/app/(app)/photo/[id]/page.tsx`, change:

```tsx
    <main className="mx-auto max-w-5xl p-4">
```

to:

```tsx
    <main className="mx-auto max-w-6xl p-4">
```

- [ ] **Step 2: Bump the modal-intercept wrapper**

In `apps/web/src/app/(app)/@modal/(.)photo/[id]/page.tsx`, change:

```tsx
      <main className="mx-auto max-w-5xl p-4">
```

to:

```tsx
      <main className="mx-auto max-w-6xl p-4">
```

- [ ] **Step 3: Build (type-check)**

Run: `pnpm --filter @lumio/web build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/\(app\)/photo/\[id\]/page.tsx "apps/web/src/app/(app)/@modal/(.)photo/[id]/page.tsx"
git commit -m "feat(web): widen photo detail wrapper for the side pane"
```

---

### Task 3: Browser verification

**Files:** none (manual verification)

- [ ] **Step 1: Run the dev server**

Run: `pnpm dev` (from repo root) and open a photo via the grid (soft-nav modal) and via a direct `/photo/<id>` URL (standalone page).

- [ ] **Step 2: Verify wide viewport**

Expected: image on the left, details pane on the right; filename + source badge + dimensions at top; Taken / Camera / Hash rows; album checkboxes; "Show all EXIF" collapsed. No "Details" button, no slide-out sheet.

- [ ] **Step 3: Verify narrow viewport**

Resize below the `lg` breakpoint (1024px). Expected: the pane stacks **below** the image at full width; everything still visible.

- [ ] **Step 4: Verify album toggle + EXIF disclosure**

Expected: toggling an album checkbox adds/removes membership and the view refreshes; clicking "Show all EXIF" expands the raw JSON. In the modal overlay, Escape / back still closes it and preserves grid scroll.

---

## Self-Review

- **Spec coverage:** Layout (two-column, stacks on narrow) → Task 1 + Task 2. Pane contents header/rows/albums/EXIF → Task 1. Collapsible EXIF (spec Q2=B) → Task 1 `<details>`. Album checkboxes unchanged (user decision) → Task 1 `AlbumMembership`. Wrapper width bump → Task 2. Verification → Task 3. All spec sections covered.
- **Placeholder scan:** No TBD/TODO; full file content provided.
- **Type consistency:** `PhotoDTO`/`AlbumSummaryDTO` from `@lumio/shared` match the existing imports; `photo.exif.cameraMake`/`cameraModel` exist on `ExifData`; `Separator` is exported from `@/components/ui/separator`. `useState`/`useRouter` remain used by `AlbumMembership`, so no unused-import lint errors.
