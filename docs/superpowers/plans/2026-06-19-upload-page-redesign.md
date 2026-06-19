# Upload Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the upload page as a first-class, app-consistent experience — shared header toolbar, thumbnail tile grid with live per-file status, a batch command bar (progress → summary → Retry/View), and in-place selection + bulk organization (color label, add to album, download, delete) of the just-uploaded photos.

**Architecture:** A client orchestrator (`UploadClient`) owns the upload row state, a bounded-concurrency upload pool, object-URL lifecycle, selection, and bulk-action handlers. Presentation is split into focused components (`UploadDropzone`, `UploadCommandBar`, `UploadTile`) plus two pure, unit-tested helper modules (`upload-preview`, `upload-rows`). It reuses the exact components/endpoints `/photos` already uses (`HeaderBar`, `SelectionToolbar`, `useGridSelection/Columns/View`, `GridViewMenu`, `GridSizeMenu`, `ColorLabelMenu`, `AddToAlbumDialog`, `downloadSelection`, `useConfirm`).

**Tech Stack:** Next.js (App Router, `--webpack`), React client components, TypeScript, Tailwind + shadcn (`radix-ui`, `cva`, `cn`), Vitest, lucide-react, sonner.

**Spec:** `docs/superpowers/specs/2026-06-19-upload-page-redesign-design.md`

**Commands (run from repo root):**
- One test file: `pnpm --filter @lumio/web exec vitest run src/lib/<file>.test.ts`
- Typecheck: `pnpm --filter @lumio/web exec tsc --noEmit`
- Lint: `pnpm --filter @lumio/web lint`
- Build: `pnpm --filter @lumio/web build`
- All web tests: `pnpm --filter @lumio/web test`

---

## File structure

| File | Responsibility |
|---|---|
| `apps/web/src/lib/upload-preview.ts` (new) | Pure: which formats preview in-browser; format-badge label. |
| `apps/web/src/lib/upload-preview.test.ts` (new) | Unit tests for the above. |
| `apps/web/src/lib/upload-rows.ts` (new) | Pure: `Row`/`RowStatus` types, `summarizeRows`, `selectableIds`. |
| `apps/web/src/lib/upload-rows.test.ts` (new) | Unit tests for the above. |
| `apps/web/src/components/ui/progress.tsx` (new) | shadcn-style Progress over `radix-ui`. |
| `apps/web/src/app/(app)/upload/upload-tile.tsx` (new) | Presentational tile: preview/badge + status overlay + selection. |
| `apps/web/src/app/(app)/upload/upload-dropzone.tsx` (new) | Hero + slim drop zone variants, drag + hidden inputs. |
| `apps/web/src/app/(app)/upload/upload-command-bar.tsx` (new) | Progress / outcome counts / Retry failed / View library. |
| `apps/web/src/app/(app)/upload/upload-client.tsx` (rewrite) | Orchestrator: state, pool, selection, bulk actions, header swap. |
| `apps/web/src/app/(app)/upload/page.tsx` (modify) | Wrapper → `<main className="w-full px-6 pb-6">`; drop bare `<h1>`. |

---

### Task 1: `upload-preview` helper (TDD)

**Files:**
- Create: `apps/web/src/lib/upload-preview.ts`
- Test: `apps/web/src/lib/upload-preview.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/web/src/lib/upload-preview.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatBadge, isPreviewable } from "./upload-preview";

describe("isPreviewable", () => {
  it("accepts browser-decodable formats, case-insensitively", () => {
    expect(isPreviewable("photo.jpg")).toBe(true);
    expect(isPreviewable("PHOTO.JPEG")).toBe(true);
    expect(isPreviewable("a.png")).toBe(true);
    expect(isPreviewable("a.WebP")).toBe(true);
  });
  it("rejects non-browser formats and extensionless names", () => {
    expect(isPreviewable("a.heic")).toBe(false);
    expect(isPreviewable("a.heif")).toBe(false);
    expect(isPreviewable("scan.jxl")).toBe(false);
    expect(isPreviewable("README")).toBe(false);
  });
});

describe("formatBadge", () => {
  it("returns the uppercased extension without the dot", () => {
    expect(formatBadge("a.heic")).toBe("HEIC");
    expect(formatBadge("a.JXL")).toBe("JXL");
    expect(formatBadge("a.heif")).toBe("HEIF");
  });
  it("falls back to FILE when there is no extension", () => {
    expect(formatBadge("README")).toBe("FILE");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lumio/web exec vitest run src/lib/upload-preview.test.ts`
Expected: FAIL — cannot resolve `./upload-preview`.

- [ ] **Step 3: Write minimal implementation**

`apps/web/src/lib/upload-preview.ts`:

```ts
/**
 * Which uploaded files the browser can render as an inline preview before the
 * server has processed them. The library also supports .jxl/.heic/.heif, which
 * browsers cannot decode — those get a format-badge tile instead.
 */
export const PREVIEWABLE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

function extOf(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot < 0 ? "" : filename.slice(dot).toLowerCase();
}

export function isPreviewable(filename: string): boolean {
  return PREVIEWABLE_EXTENSIONS.has(extOf(filename));
}

/** Uppercased extension without the dot (e.g. "HEIC"); "FILE" when extensionless. */
export function formatBadge(filename: string): string {
  const ext = extOf(filename);
  return ext ? ext.slice(1).toUpperCase() : "FILE";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lumio/web exec vitest run src/lib/upload-preview.test.ts`
Expected: PASS (6 assertions).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/upload-preview.ts apps/web/src/lib/upload-preview.test.ts
git commit -m "feat(web): upload-preview helper (previewable formats + badge label)"
```

---

### Task 2: `upload-rows` helper (TDD)

**Files:**
- Create: `apps/web/src/lib/upload-rows.ts`
- Test: `apps/web/src/lib/upload-rows.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/web/src/lib/upload-rows.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { selectableIds, summarizeRows, type Row } from "./upload-rows";

function mkRow(p: Partial<Row> & Pick<Row, "status">): Row {
  return {
    id: p.id ?? 1,
    file: p.file ?? ({} as File),
    name: p.name ?? "x.jpg",
    status: p.status,
    message: p.message,
    photoId: p.photoId,
    previewUrl: p.previewUrl,
  };
}

describe("summarizeRows", () => {
  it("counts outcomes and treats queued/uploading as pending", () => {
    const rows = [
      mkRow({ id: 1, status: "added", photoId: "a" }),
      mkRow({ id: 2, status: "added", photoId: "b" }),
      mkRow({ id: 3, status: "duplicate", photoId: "c" }),
      mkRow({ id: 4, status: "error", message: "boom" }),
      mkRow({ id: 5, status: "uploading" }),
      mkRow({ id: 6, status: "queued" }),
    ];
    expect(summarizeRows(rows)).toEqual({
      total: 6, done: 4, uploading: 2, added: 2, duplicate: 1, error: 1,
    });
  });
  it("is all-zero for an empty list", () => {
    expect(summarizeRows([])).toEqual({
      total: 0, done: 0, uploading: 0, added: 0, duplicate: 0, error: 0,
    });
  });
});

describe("selectableIds", () => {
  it("returns photo ids only for rows that have one", () => {
    const rows = [
      mkRow({ id: 1, status: "added", photoId: "a" }),
      mkRow({ id: 2, status: "duplicate", photoId: "b" }),
      mkRow({ id: 3, status: "error" }),
      mkRow({ id: 4, status: "uploading" }),
    ];
    expect(selectableIds(rows)).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @lumio/web exec vitest run src/lib/upload-rows.test.ts`
Expected: FAIL — cannot resolve `./upload-rows`.

- [ ] **Step 3: Write minimal implementation**

`apps/web/src/lib/upload-rows.ts`:

```ts
/** A single file's lifecycle in the uploader. `unsupported` files are NOT rows —
 * they're counted separately so a dropped folder of junk can't flood the grid. */
export type RowStatus = "queued" | "uploading" | "added" | "duplicate" | "error";

export interface Row {
  /** Client-side row id (monotonic counter). */
  id: number;
  /** Retained so a failed upload can be retried. */
  file: File;
  name: string;
  status: RowStatus;
  message?: string;
  /** Real photo id from the API, set for added | duplicate. Enables selection. */
  photoId?: string;
  /** Object URL for previewable formats; revoked on removal/unmount. */
  previewUrl?: string;
}

export interface RowSummary {
  total: number;
  /** added + duplicate + error. */
  done: number;
  /** queued + uploading (still in flight). */
  uploading: number;
  added: number;
  duplicate: number;
  error: number;
}

export function summarizeRows(rows: Row[]): RowSummary {
  let added = 0;
  let duplicate = 0;
  let error = 0;
  let pending = 0;
  for (const r of rows) {
    if (r.status === "added") added++;
    else if (r.status === "duplicate") duplicate++;
    else if (r.status === "error") error++;
    else pending++; // queued | uploading
  }
  return {
    total: rows.length,
    done: added + duplicate + error,
    uploading: pending,
    added,
    duplicate,
    error,
  };
}

/** Photo ids of rows that can be selected/organized (those that have one). */
export function selectableIds(rows: Row[]): string[] {
  return rows.filter((r) => r.photoId).map((r) => r.photoId as string);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @lumio/web exec vitest run src/lib/upload-rows.test.ts`
Expected: PASS (3 assertions).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/upload-rows.ts apps/web/src/lib/upload-rows.test.ts
git commit -m "feat(web): upload-rows helper (Row type, summarizeRows, selectableIds)"
```

---

### Task 3: shadcn `Progress` component

**Files:**
- Create: `apps/web/src/components/ui/progress.tsx`

- [ ] **Step 1: Write the component**

`apps/web/src/components/ui/progress.tsx`:

```tsx
"use client";

import * as React from "react";
import { Progress as ProgressPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn(
        "relative h-2 w-full overflow-hidden rounded-full bg-primary/15",
        className,
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="h-full w-full flex-1 bg-primary transition-transform"
        style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress };
```

- [ ] **Step 2: Verify it typechecks**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: PASS (no errors). If `radix-ui` does not export `Progress`, fall back to installing `@radix-ui/react-progress` and importing `* as ProgressPrimitive from "@radix-ui/react-progress"` — but confirm the unified `radix-ui` export first (badge.tsx imports `Slot` from `"radix-ui"`, so the unified package is the project convention).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ui/progress.tsx
git commit -m "feat(web): add shadcn Progress component"
```

---

### Task 4: `UploadTile` component

**Files:**
- Create: `apps/web/src/app/(app)/upload/upload-tile.tsx`

Matches `/photos` selection affordance: `ring-2 ring-inset ring-primary` on the selected tile, a `CheckCircle2`/`Circle` overlay, and `scale-[0.92]` shrink on the inner content.

- [ ] **Step 1: Write the component**

`apps/web/src/app/(app)/upload/upload-tile.tsx`:

```tsx
"use client";

import { CheckCircle2, Circle, Loader2, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { formatBadge, isPreviewable } from "@/lib/upload-preview";
import type { GridViewMode } from "@/lib/use-grid-view";
import type { RowStatus } from "@/lib/upload-rows";

const STATUS_LABEL: Record<RowStatus, string> = {
  queued: "Queued",
  uploading: "Uploading…",
  added: "Added",
  duplicate: "Already in library",
  error: "Failed",
};

export function UploadTile({
  name,
  status,
  message,
  previewUrl,
  mode,
  selectMode,
  selectable,
  selected,
  onToggleSelect,
  onRetry,
}: {
  name: string;
  status: RowStatus;
  message?: string;
  previewUrl?: string;
  mode: GridViewMode;
  selectMode: boolean;
  selectable: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onRetry: () => void;
}) {
  const preview = isPreviewable(name) && previewUrl;
  const fit = mode === "fit" ? "object-contain" : "object-cover";
  const interactive = selectMode && selectable;

  const thumb = (
    <div
      className={cn(
        "relative aspect-square overflow-hidden rounded-md border border-border bg-muted",
        mode === "card" && "p-2",
        selected && "ring-2 ring-inset ring-primary",
      )}
    >
      <div
        className={cn(
          "h-full w-full overflow-hidden rounded-[inherit] transition-transform",
          selected && "scale-[0.92]",
        )}
      >
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element -- blob: object URL, no remote loader
          <img src={previewUrl} alt="" className={cn("h-full w-full", fit)} />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-gradient-to-br from-muted to-muted-foreground/15 text-muted-foreground">
            <span className="text-base font-bold tracking-wide">{formatBadge(name)}</span>
            <span className="text-[10px] uppercase tracking-wide">preview after import</span>
          </div>
        )}
      </div>

      {status === "uploading" || status === "queued" ? (
        <div className="absolute inset-0 flex items-center justify-center bg-foreground/40">
          <Loader2 className="size-5 animate-spin text-background" aria-hidden />
        </div>
      ) : null}

      {status === "added" ? (
        <span className="absolute right-1.5 top-1.5 rounded-full bg-background">
          <CheckCircle2 className="size-5 text-primary" aria-hidden />
        </span>
      ) : null}

      {status === "duplicate" ? (
        <span className="absolute right-1.5 top-1.5 rounded-full bg-background px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
          Duplicate
        </span>
      ) : null}

      {status === "error" ? (
        <div className="absolute inset-0 flex items-center justify-center bg-destructive/55">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-7 gap-1 px-2 text-xs"
            onClick={(e) => {
              e.stopPropagation();
              onRetry();
            }}
          >
            <RotateCw className="size-3" aria-hidden /> Retry
          </Button>
        </div>
      ) : null}

      {selectMode && selectable ? (
        <span className="absolute left-1.5 top-1.5 rounded-full bg-background">
          {selected ? (
            <CheckCircle2 className="size-5 text-primary" aria-hidden />
          ) : (
            <Circle className="size-5 text-muted-foreground" aria-hidden />
          )}
        </span>
      ) : null}
    </div>
  );

  return (
    <div className="flex flex-col gap-1.5">
      {interactive ? (
        <button
          type="button"
          aria-pressed={selected}
          onClick={onToggleSelect}
          title={message ?? STATUS_LABEL[status]}
          className="block select-none rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {thumb}
        </button>
      ) : (
        <div title={message ?? STATUS_LABEL[status]}>{thumb}</div>
      )}
      <p
        className="truncate text-center font-mono text-[11px] text-muted-foreground"
        title={name}
      >
        {name}
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/\(app\)/upload/upload-tile.tsx
git commit -m "feat(web): UploadTile (preview/badge + status overlay + selection)"
```

---

### Task 5: `UploadDropzone` component

**Files:**
- Create: `apps/web/src/app/(app)/upload/upload-dropzone.tsx`

- [ ] **Step 1: Write the component**

`apps/web/src/app/(app)/upload/upload-dropzone.tsx`:

```tsx
"use client";

import { useRef, useState } from "react";
import { UploadCloud } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { collectFiles } from "@/lib/upload-collect";

/**
 * Drop target + file/folder pickers. `hero` is the large empty-state panel;
 * `slim` is the compact "drop more" bar shown once files exist. Both report
 * collected files via `onFiles`.
 */
export function UploadDropzone({
  variant,
  onFiles,
}: {
  variant: "hero" | "slim";
  onFiles: (files: File[]) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const dragProps = {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(true);
    },
    onDragLeave: () => setDragging(false),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      void collectFiles(e.dataTransfer).then(onFiles);
    },
  };

  const inputs = (
    <>
      <input
        ref={fileRef}
        type="file"
        multiple
        accept="image/*,.jxl,.heic,.heif"
        className="hidden"
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      {/* No `accept`: browsers ignore it with webkitdirectory; partitionSupported filters instead. */}
      <input
        ref={folderRef}
        type="file"
        {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
        multiple
        className="hidden"
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
    </>
  );

  if (variant === "slim") {
    return (
      <div
        {...dragProps}
        className={cn(
          "flex flex-wrap items-center gap-2 rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground transition-colors",
          dragging ? "border-foreground bg-muted" : "border-border",
        )}
      >
        <UploadCloud className="size-4 shrink-0" aria-hidden />
        <span>
          <span className="font-medium text-foreground">Drop more</span> here,{" "}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="text-primary underline-offset-4 hover:underline"
          >
            browse files
          </button>{" "}
          or{" "}
          <button
            type="button"
            onClick={() => folderRef.current?.click()}
            className="text-primary underline-offset-4 hover:underline"
          >
            add a folder
          </button>
        </span>
        {inputs}
      </div>
    );
  }

  return (
    <div
      {...dragProps}
      className={cn(
        "flex w-full flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed py-16 text-center transition-colors",
        dragging ? "border-foreground bg-muted" : "border-border",
      )}
    >
      <UploadCloud className="size-10 text-muted-foreground" strokeWidth={1.6} aria-hidden />
      <p className="text-sm font-medium">Drag photos or a folder here</p>
      <div className="flex items-center gap-2">
        <Button type="button" size="sm" onClick={() => fileRef.current?.click()}>
          Browse files
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => folderRef.current?.click()}>
          Add a folder
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">JPEG · PNG · WebP · HEIC · HEIF · JXL</p>
      {inputs}
    </div>
  );
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/\(app\)/upload/upload-dropzone.tsx
git commit -m "feat(web): UploadDropzone (hero + slim variants, drag + pickers)"
```

---

### Task 6: `UploadCommandBar` component

**Files:**
- Create: `apps/web/src/app/(app)/upload/upload-command-bar.tsx`

- [ ] **Step 1: Write the component**

`apps/web/src/app/(app)/upload/upload-command-bar.tsx`:

```tsx
"use client";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { RowSummary } from "@/lib/upload-rows";

/**
 * Batch status bar. While files are in flight it shows a progress bar; once the
 * batch settles it shows outcome counts plus Retry-failed / View-library. Stays
 * mounted in select mode (it's batch info, not selection chrome).
 */
export function UploadCommandBar({
  summary,
  unsupportedCount,
  onRetryFailed,
  onViewLibrary,
}: {
  summary: RowSummary;
  unsupportedCount: number;
  onRetryFailed: () => void;
  onViewLibrary: () => void;
}) {
  const uploading = summary.uploading > 0;
  const pct = summary.total === 0 ? 0 : Math.round((summary.done / summary.total) * 100);

  return (
    <div className="rounded-xl border border-border bg-muted/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">
            {uploading ? `Uploading ${summary.done} of ${summary.total}…` : "Upload complete"}
          </p>
          {!uploading ? (
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <Count dot="bg-primary" label={`${summary.added} added`} />
              {summary.duplicate > 0 ? (
                <Count
                  dot="bg-amber-500"
                  label={`${summary.duplicate} ${summary.duplicate === 1 ? "duplicate" : "duplicates"}`}
                />
              ) : null}
              {summary.error > 0 ? <Count dot="bg-destructive" label={`${summary.error} failed`} /> : null}
              {unsupportedCount > 0 ? (
                <Count dot="bg-muted-foreground" label={`${unsupportedCount} unsupported`} />
              ) : null}
            </div>
          ) : null}
        </div>

        {!uploading ? (
          <div className="flex items-center gap-2">
            {summary.error > 0 ? (
              <Button variant="outline" size="sm" onClick={onRetryFailed}>
                Retry failed
              </Button>
            ) : null}
            <Button size="sm" onClick={onViewLibrary}>
              View library
            </Button>
          </div>
        ) : null}
      </div>

      {uploading ? <Progress value={pct} className="mt-3" /> : null}
    </div>
  );
}

function Count({ dot, label }: { dot: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("size-2 rounded-full", dot)} />
      {label}
    </span>
  );
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/\(app\)/upload/upload-command-bar.tsx
git commit -m "feat(web): UploadCommandBar (progress / counts / retry / view library)"
```

---

### Task 7: Rewrite `UploadClient` + update `page.tsx`

**Files:**
- Rewrite: `apps/web/src/app/(app)/upload/upload-client.tsx`
- Modify: `apps/web/src/app/(app)/upload/page.tsx`

- [ ] **Step 1: Rewrite the orchestrator**

Replace the entire contents of `apps/web/src/app/(app)/upload/upload-client.tsx` with:

```tsx
"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download } from "lucide-react";
import type { ColorLabel } from "@lumio/shared";
import { Button } from "@/components/ui/button";
import { HeaderBar } from "@/components/header-bar";
import { GridViewMenu } from "@/components/grid-view-menu";
import { GridSizeMenu } from "@/components/grid-size-menu";
import { ColorLabelMenu } from "@/components/photo-actions/color-label-menu";
import { AddToAlbumDialog } from "@/components/photo-actions/add-to-album-dialog";
import { useConfirm } from "@/components/confirm-dialog";
import { useGridSelection } from "@/lib/use-grid-selection";
import { useGridColumns } from "@/lib/use-grid-columns";
import { useGridView } from "@/lib/use-grid-view";
import { downloadSelection } from "@/lib/download-client";
import { partitionSupported } from "@/lib/upload-collect";
import { isPreviewable } from "@/lib/upload-preview";
import { selectableIds, summarizeRows, type Row, type RowStatus } from "@/lib/upload-rows";
import { SelectionToolbar } from "../photos/selection-toolbar";
import { UploadDropzone } from "./upload-dropzone";
import { UploadCommandBar } from "./upload-command-bar";
import { UploadTile } from "./upload-tile";

const CONCURRENCY = 3;
let nextRowId = 1;

type UploadResponse = { status: RowStatus | "unsupported"; id?: string; message?: string };

export function UploadClient() {
  const router = useRouter();
  const sel = useGridSelection();
  const { columns, setColumns } = useGridColumns();
  const { mode, setMode } = useGridView();
  const { confirm, confirmDialog } = useConfirm();

  const [rows, setRows] = useState<Row[]>([]);
  const [unsupportedCount, setUnsupportedCount] = useState(0);
  const [albumOpen, setAlbumOpen] = useState(false);
  const [labelPending, setLabelPending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // Revoke any object URLs we created when the component unmounts.
  const urlsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const urls = urlsRef.current;
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, []);

  const update = useCallback((id: number, patch: Partial<Row>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }, []);

  const uploadOne = useCallback(
    async (file: File, rowId: number) => {
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
          return;
        }
        update(rowId, { status: data.status, message: data.message, photoId: data.id });
      } catch (err) {
        update(rowId, { status: "error", message: (err as Error).message });
      }
    },
    [update],
  );

  // Bounded-concurrency worker pool shared by initial uploads and retries.
  const runPool = useCallback(
    async (queued: Array<{ file: File; rowId: number }>) => {
      if (queued.length === 0) return;
      let cursor = 0;
      async function worker() {
        while (cursor < queued.length) {
          const item = queued[cursor++];
          if (item) await uploadOne(item.file, item.rowId);
        }
      }
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queued.length) }, worker));
      router.refresh();
    },
    [router, uploadOne],
  );

  const addFiles = useCallback(
    async (incoming: File[]) => {
      const { supported, skipped } = partitionSupported(incoming);
      if (skipped > 0) setUnsupportedCount((n) => n + skipped);
      if (supported.length === 0) return;
      const queued = supported.map((file) => {
        const rowId = nextRowId++;
        let previewUrl: string | undefined;
        if (isPreviewable(file.name)) {
          previewUrl = URL.createObjectURL(file);
          urlsRef.current.add(previewUrl);
        }
        return { file, rowId, previewUrl };
      });
      setRows((prev) => [
        ...queued.map(({ file, rowId, previewUrl }) => ({
          id: rowId,
          file,
          name: file.name,
          status: "queued" as const,
          previewUrl,
        })),
        ...prev,
      ]);
      await runPool(queued.map(({ file, rowId }) => ({ file, rowId })));
    },
    [runPool],
  );

  const retryRows = useCallback(
    (targets: Row[]) => {
      void runPool(targets.map((r) => ({ file: r.file, rowId: r.id })));
    },
    [runPool],
  );

  const applyLabel = useCallback(
    async (label: ColorLabel | null) => {
      if (labelPending || sel.selected.size === 0) return;
      setLabelPending(true);
      try {
        const res = await fetch("/api/photos/color-label", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ photoIds: [...sel.selected], label }),
        });
        if (!res.ok) throw new Error("label failed");
        toast.success("Label applied.");
        sel.clear();
      } catch {
        toast.error("Failed to apply label.");
      } finally {
        setLabelPending(false);
      }
    },
    [labelPending, sel],
  );

  const handleDownload = useCallback(async () => {
    if (downloading || sel.selected.size === 0) return;
    setDownloading(true);
    try {
      await downloadSelection([...sel.selected]);
      sel.clear();
    } catch {
      toast.error("Failed to download photos.");
    } finally {
      setDownloading(false);
    }
  }, [downloading, sel]);

  const handleDelete = useCallback(async () => {
    const selectedIds = sel.selected;
    if (selectedIds.size === 0 || deleting) return;
    const label = `${selectedIds.size} ${selectedIds.size === 1 ? "photo" : "photos"}`;
    const ok = await confirm({
      title: `Move ${label} to Trash?`,
      description: "They'll be moved to Trash. You can restore them later.",
      confirmLabel: "Move to Trash",
      destructive: true,
    });
    if (!ok) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/photos/trash", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: [...selectedIds] }),
      });
      if (!res.ok) throw new Error("trash failed");
      setRows((prev) =>
        prev.filter((r) => {
          const remove = Boolean(r.photoId && selectedIds.has(r.photoId));
          if (remove && r.previewUrl) {
            URL.revokeObjectURL(r.previewUrl);
            urlsRef.current.delete(r.previewUrl);
          }
          return !remove;
        }),
      );
      sel.cancel();
      router.refresh();
    } catch {
      toast.error("Failed to move photos to Trash.");
    } finally {
      setDeleting(false);
    }
  }, [sel, deleting, confirm, router]);

  const summary = summarizeRows(rows);
  const ids = selectableIds(rows);
  const hasRows = rows.length > 0;

  return (
    <>
      {confirmDialog}

      {sel.selectMode ? (
        <SelectionToolbar
          title="Select photos"
          count={sel.count}
          onCancel={sel.cancel}
          actions={
            <>
              <ColorLabelMenu
                disabled={sel.count === 0 || labelPending}
                onPick={(l) => void applyLabel(l)}
              />
              <Button size="sm" disabled={sel.count === 0} onClick={() => setAlbumOpen(true)}>
                Add to album
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={sel.count === 0 || downloading}
                onClick={() => void handleDownload()}
              >
                <Download aria-hidden />
                {downloading ? "Preparing…" : "Download"}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={sel.count === 0 || deleting}
                onClick={() => void handleDelete()}
              >
                {deleting ? "Deleting…" : "Delete"}
              </Button>
            </>
          }
        />
      ) : (
        <HeaderBar
          title="Upload"
          actions={
            hasRows ? (
              <>
                <GridViewMenu mode={mode} onModeChange={setMode} />
                <GridSizeMenu columns={columns} onColumnsChange={setColumns} />
                <Button
                  variant="outline"
                  size="sm"
                  disabled={ids.length === 0}
                  onClick={sel.enter}
                >
                  Select
                </Button>
              </>
            ) : null
          }
        />
      )}

      <div className="space-y-6 pt-2">
        <UploadDropzone variant={hasRows ? "slim" : "hero"} onFiles={(f) => void addFiles(f)} />

        {hasRows ? (
          <UploadCommandBar
            summary={summary}
            unsupportedCount={unsupportedCount}
            onRetryFailed={() => retryRows(rows.filter((r) => r.status === "error"))}
            onViewLibrary={() => router.push("/photos")}
          />
        ) : unsupportedCount > 0 ? (
          <p className="text-sm text-muted-foreground">
            Skipped {unsupportedCount} unsupported file{unsupportedCount === 1 ? "" : "s"}.
          </p>
        ) : null}

        {hasRows ? (
          <div
            className="grid gap-3"
            style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
          >
            {rows.map((row) => {
              const selectable = Boolean(row.photoId);
              const selected = Boolean(row.photoId && sel.selected.has(row.photoId));
              return (
                <UploadTile
                  key={row.id}
                  name={row.name}
                  status={row.status}
                  message={row.message}
                  previewUrl={row.previewUrl}
                  mode={mode}
                  selectMode={sel.selectMode}
                  selectable={selectable}
                  selected={selected}
                  onToggleSelect={() => {
                    if (!row.photoId) return;
                    const next = new Set(sel.selected);
                    if (next.has(row.photoId)) next.delete(row.photoId);
                    else next.add(row.photoId);
                    sel.setSelected(next);
                  }}
                  onRetry={() => retryRows([row])}
                />
              );
            })}
          </div>
        ) : null}
      </div>

      <AddToAlbumDialog
        open={albumOpen}
        onOpenChange={setAlbumOpen}
        photoIds={[...sel.selected]}
        onAdded={() => {
          setAlbumOpen(false);
          sel.clear();
        }}
      />
    </>
  );
}
```

- [ ] **Step 2: Update the page wrapper**

Replace the entire contents of `apps/web/src/app/(app)/upload/page.tsx` with:

```tsx
import { UploadClient } from "./upload-client";

export default function UploadPage() {
  return (
    <main className="w-full px-6 pb-6">
      <UploadClient />
    </main>
  );
}
```

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: PASS.
Run: `pnpm --filter @lumio/web lint`
Expected: PASS (the only `@next/next/no-img-element` is suppressed inline in `upload-tile.tsx`).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/\(app\)/upload/upload-client.tsx apps/web/src/app/\(app\)/upload/page.tsx
git commit -m "feat(web): rebuild upload page (header toolbar, tile grid, command bar, select + bulk actions)"
```

---

### Task 8: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full web test suite**

Run: `pnpm --filter @lumio/web test`
Expected: PASS, including the new `upload-preview` and `upload-rows` suites. Existing `upload-collect.test.ts` still passes (unchanged).

- [ ] **Step 2: Typecheck + lint + production build**

Run: `pnpm --filter @lumio/web exec tsc --noEmit` → PASS
Run: `pnpm --filter @lumio/web lint` → PASS
Run: `pnpm --filter @lumio/web build` → PASS (compiles, no type errors).

- [ ] **Step 3: Browser verification (project norm — dev server)**

Start dev (`pnpm dev`) and at `/upload` confirm, in **light and dark**:
1. **Empty state:** title-only header; large hero with Browse files / Add a folder.
2. Drag a mixed batch (a `.jpg` + a `.png` + a `.heic`/`.jxl` + a junk `.txt`): tiles appear (previews for jpg/png, format-badge for heic/jxl), spinners → checks; the `.txt` is **not** tiled and shows as the "unsupported" count.
3. **Command bar:** progress while uploading → "Upload complete" with outcome counts; drop zone collapsed to the slim bar; header gained Grid view / Grid size / Select.
4. **Grid controls:** Grid size changes tile density; Grid view toggles fill/fit/card.
5. **Select:** enter select mode → header swaps to the selection toolbar; select added/duplicate tiles; **Color**, **Add to album**, **Download**, **Delete** all act on the selection; Delete removes the tiles; Cancel/Escape exits.
6. **View library** navigates to `/photos`.
7. If an upload errors, the tile shows the red overlay + inline **Retry**, and the command bar shows **Retry failed**; both re-upload.

- [ ] **Step 4: Final commit (if any browser-fix tweaks were needed)**

```bash
git add -A
git commit -m "fix(web): upload page polish from browser verification"
```

---

## Self-review notes

- **Spec coverage:** header three-state swap (Task 7) ✓; collapsing drop zone (Task 5) ✓; command bar progress→summary + Retry/View (Task 6/7) ✓; tiles preview/badge + status overlays (Task 4) ✓; select + bulk actions reusing /photos plumbing (Task 7) ✓; unsupported = count-only (Tasks 2/6/7) ✓; previewable subset jpg/jpeg/png/webp (Task 1) ✓; object-URL revoke on delete + unmount (Task 7) ✓; shadcn Progress (Task 3) ✓; page wrapper px-6 (Task 7) ✓.
- **Type consistency:** `Row`/`RowStatus`/`RowSummary` defined in Task 2 are imported unchanged by Tasks 4/6/7; `summarizeRows`/`selectableIds` signatures match call sites; `GridViewMode` reused from `use-grid-view`; component prop names match between definition and `UploadClient` usage.
- **No placeholders:** every code step is complete and runnable.
