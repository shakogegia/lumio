# Color Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user apply one of 8 pastel Lightroom-style color labels to a multi-selection of photos from the Library toolbar, and show each label by tinting the photo's mat in card view.

**Architecture:** A single `COLOR_LABELS` palette config in `@lumio/shared` is the source of truth (slug ⇄ name ⇄ hex). The Photo gains a nullable `colorLabel` Prisma enum column, surfaced on `PhotoDTO`. A batch `POST /api/photos/color-label` route → `setPhotoColorLabel` service → `updateMany`. The Library toolbar gets a "Label" dropdown of swatches; applying optimistically patches the client-fetched grid (via an imperative `patchPhotos` handle on `PhotoGrid`) so the card tint repaints instantly without losing scroll. Card-mode tiles paint the label hex over the muted mat.

**Tech Stack:** TypeScript, Next.js 16 (App Router, React 19), Prisma 6 / PostgreSQL, Zod 3, Radix DropdownMenu, Tailwind/cva, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-19-color-labels-design.md`

**Preconditions for tasks that touch the DB:** the dev Postgres must be running (`pnpm db:up`; it lives on port 5433 per project setup).

**Conventions:**
- Services accept an injectable `db` param defaulting to `prisma`; tests pass a fake `db as never`.
- UI is browser-verified (the repo has no React-render test harness); pure logic is unit-tested.
- Commit after each task.

---

## File Structure

**`@lumio/shared`** (`packages/shared/src/`)
- Create `color-labels.ts` — `ColorLabel` type, `colorLabelSchema`, `COLOR_LABEL_SLUGS`, `COLOR_LABELS`, `colorLabelHex()`.
- Create `color-labels.test.ts` — palette/helper/schema tests.
- Modify `index.ts` — re-export `./color-labels.js`.
- Modify `api.ts` — `setColorLabelSchema` (+ `SetColorLabelBody`).
- Modify `api.test.ts` — `setColorLabelSchema` tests.
- Modify `types.ts` — add `colorLabel` to `PhotoDTO`.

**`@lumio/db`** (`packages/db/`)
- Modify `prisma/schema.prisma` — `ColorLabel` enum + `Photo.colorLabel`.
- New generated migration under `prisma/migrations/`.
- Modify `src/mappers.ts` — map `colorLabel` onto the DTO.

**`@lumio/web`** (`apps/web/src/`)
- Modify `lib/photos-service.ts` — `setPhotoColorLabel()`.
- Modify `lib/photos-service.test.ts` — service tests.
- Create `app/api/photos/color-label/route.ts` — batch POST.
- Modify `components/photo-grid/use-photo-pages.ts` — `patchPhotos`.
- Modify `components/photo-grid/photo-grid.tsx` — `PhotoGridHandle` + `apiRef`.
- Modify `components/photo-grid/photo-grid-tile.tsx` — card tint.
- Create `app/(app)/photos/color-label-menu.tsx` — swatch dropdown.
- Modify `app/(app)/photos/library-view.tsx` — wire menu + optimistic apply.

---

## Task 1: Palette config + schema (`@lumio/shared`)

**Files:**
- Create: `packages/shared/src/color-labels.ts`
- Test: `packages/shared/src/color-labels.test.ts`
- Modify: `packages/shared/src/index.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/shared/src/color-labels.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  COLOR_LABELS,
  COLOR_LABEL_SLUGS,
  colorLabelHex,
  colorLabelSchema,
} from "./color-labels.js";

describe("COLOR_LABELS palette", () => {
  it("has 8 entries whose slugs match the schema options in order", () => {
    expect(COLOR_LABELS.map((c) => c.slug)).toEqual([...COLOR_LABEL_SLUGS]);
    expect(COLOR_LABEL_SLUGS).toEqual([
      "gray",
      "pink",
      "orange",
      "yellow",
      "green",
      "cyan",
      "blue",
      "purple",
    ]);
  });

  it("every entry has a name and a hex color", () => {
    for (const c of COLOR_LABELS) {
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.hex).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});

describe("colorLabelHex", () => {
  it("returns the hex for a known slug", () => {
    expect(colorLabelHex("green")).toBe("#D0E3C9");
  });

  it("returns undefined for null/undefined", () => {
    expect(colorLabelHex(null)).toBeUndefined();
    expect(colorLabelHex(undefined)).toBeUndefined();
  });
});

describe("colorLabelSchema", () => {
  it("accepts a valid slug", () => {
    expect(colorLabelSchema.parse("blue")).toBe("blue");
  });

  it("rejects an unknown slug", () => {
    expect(() => colorLabelSchema.parse("magenta")).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @lumio/shared test -- color-labels`
Expected: FAIL — cannot resolve `./color-labels.js` / exports undefined.

- [ ] **Step 3: Write the implementation**

Create `packages/shared/src/color-labels.ts`:

```ts
import { z } from "zod";

/**
 * The fixed pastel color-label palette — the single source of truth for slugs,
 * display names, order, and hex. The Prisma `ColorLabel` enum mirrors these
 * slugs 1:1; renaming or recoloring needs no migration, only editing this file.
 * Numbers (1..8) in the UI are just the array order.
 */
export const colorLabelSchema = z.enum([
  "gray",
  "pink",
  "orange",
  "yellow",
  "green",
  "cyan",
  "blue",
  "purple",
]);

export type ColorLabel = z.infer<typeof colorLabelSchema>;

/** Ordered tuple of valid slugs, derived from the schema (keeps them in lockstep). */
export const COLOR_LABEL_SLUGS = colorLabelSchema.options;

export const COLOR_LABELS: ReadonlyArray<{ slug: ColorLabel; name: string; hex: string }> = [
  { slug: "gray", name: "Gray", hex: "#DBCBCE" },
  { slug: "pink", name: "Pink", hex: "#FFD2CE" },
  { slug: "orange", name: "Orange", hex: "#FAD5B4" },
  { slug: "yellow", name: "Yellow", hex: "#F8E9B7" },
  { slug: "green", name: "Green", hex: "#D0E3C9" },
  { slug: "cyan", name: "Cyan", hex: "#B3DDE0" },
  { slug: "blue", name: "Blue", hex: "#CAD2EE" },
  { slug: "purple", name: "Purple", hex: "#E4C8E7" },
];

const HEX_BY_SLUG = Object.fromEntries(
  COLOR_LABELS.map((c) => [c.slug, c.hex]),
) as Record<ColorLabel, string>;

/** The hex for a label, or `undefined` when unlabeled. */
export function colorLabelHex(label: ColorLabel | null | undefined): string | undefined {
  return label ? HEX_BY_SLUG[label] : undefined;
}
```

- [ ] **Step 4: Add the barrel export**

In `packages/shared/src/index.ts`, add after the `./enums.js` line:

```ts
export * from "./color-labels.js";
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @lumio/shared test -- color-labels`
Expected: PASS (all in this file).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/color-labels.ts packages/shared/src/color-labels.test.ts packages/shared/src/index.ts
git commit -m "feat(shared): color-label palette config + schema"
```

---

## Task 2: Request schema + PhotoDTO field (`@lumio/shared`)

**Files:**
- Modify: `packages/shared/src/api.ts`
- Modify: `packages/shared/src/api.test.ts`
- Modify: `packages/shared/src/types.ts`

- [ ] **Step 1: Write the failing test**

In `packages/shared/src/api.test.ts`, update the import line and append a new `describe`. Change the top import to also pull in the new schema:

```ts
import { photosQuerySchema, searchQuerySchema, setColorLabelSchema } from "./api.js";
```

Append at the end of the file:

```ts
describe("setColorLabelSchema", () => {
  it("accepts photoIds with a valid label", () => {
    const parsed = setColorLabelSchema.parse({ photoIds: ["a", "b"], label: "green" });
    expect(parsed.photoIds).toEqual(["a", "b"]);
    expect(parsed.label).toBe("green");
  });

  it("accepts a null label (clear)", () => {
    expect(setColorLabelSchema.parse({ photoIds: ["a"], label: null }).label).toBeNull();
  });

  it("rejects an empty photoIds array", () => {
    expect(() => setColorLabelSchema.parse({ photoIds: [], label: null })).toThrow();
  });

  it("rejects an unknown label slug", () => {
    expect(() => setColorLabelSchema.parse({ photoIds: ["a"], label: "magenta" })).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @lumio/shared test -- api`
Expected: FAIL — `setColorLabelSchema` is not exported.

- [ ] **Step 3: Add the schema**

In `packages/shared/src/api.ts`, add the import at the top (below the existing `import { z } from "zod";`):

```ts
import { colorLabelSchema } from "./color-labels.js";
```

Add at the end of the file:

```ts
/** Body for POST /api/photos/color-label. `label: null` clears the label. */
export const setColorLabelSchema = z.object({
  photoIds: z.array(z.string()).min(1),
  label: colorLabelSchema.nullable(),
});

export type SetColorLabelBody = z.infer<typeof setColorLabelSchema>;
```

- [ ] **Step 4: Add the DTO field**

In `packages/shared/src/types.ts`:

Add to the imports at the top:

```ts
import type { ColorLabel } from "./color-labels.js";
```

In `interface PhotoDTO`, add this field right after `exif: ExifData;`:

```ts
  colorLabel: ColorLabel | null;
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @lumio/shared test -- api`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/api.ts packages/shared/src/api.test.ts packages/shared/src/types.ts
git commit -m "feat(shared): setColorLabelSchema + PhotoDTO.colorLabel"
```

---

## Task 3: Prisma column + migration + mapper (`@lumio/db`)

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: migration under `packages/db/prisma/migrations/` (generated)
- Modify: `packages/db/src/mappers.ts`

- [ ] **Step 1: Edit the Prisma schema**

In `packages/db/prisma/schema.prisma`, add a new enum right after the existing `enum PhotoSource { ... }` block:

```prisma
enum ColorLabel {
  gray
  pink
  orange
  yellow
  green
  cyan
  blue
  purple
}
```

In `model Photo`, add this field right after the `exif Json` line:

```prisma
  colorLabel ColorLabel?
```

- [ ] **Step 2: Ensure the database is running, then generate the migration**

Run:

```bash
pnpm db:up
pnpm --filter @lumio/db migrate --name add_color_label
```

Expected: Prisma creates `packages/db/prisma/migrations/<timestamp>_add_color_label/migration.sql` containing `CREATE TYPE "ColorLabel" AS ENUM (...)` and `ALTER TABLE "Photo" ADD COLUMN "colorLabel" "ColorLabel"`, applies it, and regenerates the client. No data backfill (column is nullable).

- [ ] **Step 3: Map the field onto the DTO**

In `packages/db/src/mappers.ts`:

Add `ColorLabel` to the `@lumio/shared` type import:

```ts
import {
  type AlbumDTO,
  type ColorLabel,
  type ExifData,
  PhotoSource,
  type PhotoDTO,
  type SmartAlbumRules,
} from "@lumio/shared";
```

In `toPhotoDTO`, add this line right after `exif: (row.exif ?? {}) as ExifData,`:

```ts
    colorLabel: row.colorLabel as ColorLabel | null,
```

- [ ] **Step 4: Typecheck the db package**

Run: `pnpm --filter @lumio/db typecheck`
Expected: PASS — `row.colorLabel` resolves (client regenerated) and the DTO shape is complete.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations packages/db/src/mappers.ts
git commit -m "feat(db): Photo.colorLabel enum column + DTO mapping"
```

---

## Task 4: `setPhotoColorLabel` service (`@lumio/web`)

**Files:**
- Modify: `apps/web/src/lib/photos-service.ts`
- Test: `apps/web/src/lib/photos-service.test.ts`

- [ ] **Step 1: Write the failing test**

In `apps/web/src/lib/photos-service.test.ts`:

Update the top import to include `vi` and the new function:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  getPhotoNeighbors,
  listPhotos,
  purgeAllPhotos,
  setPhotoColorLabel,
} from "./photos-service.js";
```

Append at the end of the file:

```ts
describe("setPhotoColorLabel", () => {
  it("sets a label on the given photos and returns the count", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 3 });
    const db = { photo: { updateMany } };
    const count = await setPhotoColorLabel(["p1", "p2", "p3"], "green", db as never);
    expect(count).toBe(3);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["p1", "p2", "p3"] } },
      data: { colorLabel: "green" },
    });
  });

  it("clears the label when given null", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const db = { photo: { updateMany } };
    const count = await setPhotoColorLabel(["p1"], null, db as never);
    expect(count).toBe(1);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["p1"] } },
      data: { colorLabel: null },
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @lumio/web test -- photos-service`
Expected: FAIL — `setPhotoColorLabel` is not exported.

- [ ] **Step 3: Write the implementation**

In `apps/web/src/lib/photos-service.ts`:

Add `ColorLabel` to the `@lumio/shared` type import (extend the existing import):

```ts
import type {
  ColorLabel,
  PhotoNeighbors,
  PhotosPage,
  PhotosQuery,
  PhotoStripItem,
} from "@lumio/shared";
```

Add this function (e.g. right after `listPhotos`):

```ts
/**
 * Set (or clear, with `null`) the color label on a batch of photos.
 * Returns the number of rows updated.
 */
export async function setPhotoColorLabel(
  photoIds: string[],
  label: ColorLabel | null,
  db: Db = prisma,
): Promise<number> {
  const { count } = await db.photo.updateMany({
    where: { id: { in: photoIds } },
    data: { colorLabel: label },
  });
  return count;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @lumio/web test -- photos-service`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/photos-service.ts apps/web/src/lib/photos-service.test.ts
git commit -m "feat(web): setPhotoColorLabel batch service"
```

---

## Task 5: Batch API route (`@lumio/web`)

**Files:**
- Create: `apps/web/src/app/api/photos/color-label/route.ts`

- [ ] **Step 1: Write the route**

Create `apps/web/src/app/api/photos/color-label/route.ts`:

```ts
import { NextResponse } from "next/server";
import { setColorLabelSchema } from "@lumio/shared";
import { setPhotoColorLabel } from "@/lib/photos-service";
import { withAuth } from "@/lib/with-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withAuth(async (request) => {
  const body: unknown = await request.json();
  const parsed = setColorLabelSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const count = await setPhotoColorLabel(parsed.data.photoIds, parsed.data.label);
  return NextResponse.json({ status: "labeled", count });
});
```

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm --filter @lumio/web lint`
Expected: PASS (no lint errors in the new file).

- [ ] **Step 3: Manually verify the endpoint (optional but recommended)**

With the dev server running (`pnpm dev`) and signed in, the route accepts `POST /api/photos/color-label` with `{ "photoIds": ["<id>"], "label": "green" }` and returns `{ "status": "labeled", "count": 1 }`. (You'll exercise it for real via the UI in Task 9.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/api/photos/color-label/route.ts
git commit -m "feat(web): POST /api/photos/color-label batch route"
```

---

## Task 6: Optimistic patch handle on the grid (`@lumio/web`)

**Files:**
- Modify: `apps/web/src/components/photo-grid/use-photo-pages.ts`
- Modify: `apps/web/src/components/photo-grid/photo-grid.tsx`

This exposes an imperative `patchPhotos` so the toolbar can repaint the client-fetched grid after a label change. No unit test (presentational/state wiring; verified in Task 9's browser pass).

- [ ] **Step 1: Add `patchPhotos` to the hook**

In `apps/web/src/components/photo-grid/use-photo-pages.ts`, add a memoized updater and return it.

Inside `usePhotoPages`, after the `loadMore` `useCallback` (and before the mount `useEffect`), add:

```ts
  const patchPhotos = useCallback((ids: Set<string>, patch: Partial<PhotoDTO>) => {
    setPhotos((prev) => prev.map((p) => (ids.has(p.id) ? { ...p, ...patch } : p)));
  }, []);
```

Change the return statement to include it:

```ts
  return { photos, done, error, loadMore, patchPhotos };
```

(`useCallback` and `PhotoDTO` are already imported in this file.)

- [ ] **Step 2: Expose the handle from `PhotoGrid`**

In `apps/web/src/components/photo-grid/photo-grid.tsx`:

Add `useImperativeHandle` to the React import (line 3):

```ts
import { useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
```

Add a `PhotoDTO` type import (alongside the existing imports, e.g. near the `GridViewMode` import):

```ts
import type { PhotoDTO } from "@lumio/shared";
```

Export the handle type just above the `PhotoGrid` function declaration:

```ts
export type PhotoGridHandle = {
  /** Merge `patch` into every loaded photo whose id is in `ids` (e.g. a new colorLabel). */
  patchPhotos: (ids: Set<string>, patch: Partial<PhotoDTO>) => void;
};
```

Add an `apiRef` prop. In the destructured props add `apiRef,` (e.g. after `onSelectionChange,`), and in the props type object add:

```ts
  /** Imperative handle for in-place photo updates (optimistic label tinting). */
  apiRef?: React.Ref<PhotoGridHandle>;
```

Update the hook call to capture `patchPhotos`:

```ts
  const { photos, done, error, loadMore, patchPhotos } = usePhotoPages(endpoint, params);
```

Wire the handle — add this right after that line:

```ts
  useImperativeHandle(apiRef, () => ({ patchPhotos }), [patchPhotos]);
```

- [ ] **Step 3: Typecheck + lint**

Run: `pnpm --filter @lumio/web lint`
Expected: PASS. (Album/search views call `PhotoGrid` without `apiRef`; it's optional, so they're unaffected.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/photo-grid/use-photo-pages.ts apps/web/src/components/photo-grid/photo-grid.tsx
git commit -m "feat(web): expose patchPhotos handle on PhotoGrid for optimistic updates"
```

---

## Task 7: Card-mode tint on the tile (`@lumio/web`)

**Files:**
- Modify: `apps/web/src/components/photo-grid/photo-grid-tile.tsx`

The label hex is applied as an inline `backgroundColor`, which overrides the cva `bg-muted` on the card mat. Only in `card` mode; `fill`/`fit` ignore the label. Verified visually in Task 9.

- [ ] **Step 1: Compute the tint and apply it to both tile variants**

In `apps/web/src/components/photo-grid/photo-grid-tile.tsx`:

Extend the `@lumio/shared` import to bring in the helper:

```ts
import { colorLabelHex, type PhotoDTO } from "@lumio/shared";
```

Inside the component body, right after `const thumb = <PhotoThumb photo={photo} mode={mode} />;`, add:

```ts
  // In card mode a labeled photo tints its mat; inline style overrides bg-muted.
  const labelHex = mode === "card" ? colorLabelHex(photo.colorLabel) : undefined;
  const labelStyle = labelHex ? { backgroundColor: labelHex } : undefined;
```

In the `selectMode` branch, add `style={labelStyle}` to the `<button>`:

```tsx
      <button
        type="button"
        aria-pressed={isSelected}
        onClick={(e) => onTileClick(index, e)}
        className={cn(cellVariants({ mode, selected: isSelected }), "select-none")}
        style={labelStyle}
      >
```

In the non-select `<Link>`, add `style={labelStyle}`:

```tsx
    <Link
      href={hrefFor ? hrefFor(photo.id) : photoHref(photo.id, albumId)}
      className={cellVariants({ mode })}
      style={labelStyle}
    >
```

(The existing `import type { PhotoDTO } from "@lumio/shared";` on line 5 is now merged into the value import above — remove the old type-only import line to avoid a duplicate.)

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm --filter @lumio/web lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/photo-grid/photo-grid-tile.tsx
git commit -m "feat(web): tint card-mode tile mat with its color label"
```

---

## Task 8: Color label dropdown menu (`@lumio/web`)

**Files:**
- Create: `apps/web/src/app/(app)/photos/color-label-menu.tsx`

A presentational dropdown: renders swatches from `COLOR_LABELS` + a "None" item, and calls `onPick`. All orchestration (fetch, optimistic patch, errors) lives in `library-view` (Task 9).

- [ ] **Step 1: Write the component**

Create `apps/web/src/app/(app)/photos/color-label-menu.tsx`:

```tsx
"use client";

import { Tag } from "lucide-react";
import { COLOR_LABELS, type ColorLabel } from "@lumio/shared";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Toolbar dropdown of the pastel color-label swatches (plus "None" to clear).
 * Pure UI: it reports the picked label (or `null`) via `onPick`; the parent owns
 * applying it to the current selection.
 */
export function ColorLabelMenu({
  disabled,
  onPick,
}: {
  disabled: boolean;
  onPick: (label: ColorLabel | null) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" disabled={disabled}>
          <Tag aria-hidden />
          Label
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        {COLOR_LABELS.map((c) => (
          <DropdownMenuItem key={c.slug} onSelect={() => onPick(c.slug)}>
            <span
              className="size-4 rounded-full ring-1 ring-foreground/10"
              style={{ backgroundColor: c.hex }}
              aria-hidden
            />
            {c.name}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onPick(null)}>None</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm --filter @lumio/web lint`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/(app)/photos/color-label-menu.tsx"
git commit -m "feat(web): ColorLabelMenu swatch dropdown"
```

---

## Task 9: Wire the menu into the Library toolbar + browser-verify (`@lumio/web`)

**Files:**
- Modify: `apps/web/src/app/(app)/photos/library-view.tsx`

- [ ] **Step 1: Add imports**

In `apps/web/src/app/(app)/photos/library-view.tsx`, update the imports.

Change the React import:

```ts
import { useRef, useState } from "react";
```

Change the PhotoGrid import to also pull the handle type, and add the new menu + shared type:

```ts
import { PhotoGrid, type PhotoGridHandle } from "@/components/photo-grid/photo-grid";
import { ColorLabelMenu } from "./color-label-menu";
import type { ColorLabel } from "@lumio/shared";
```

- [ ] **Step 2: Add the grid ref, error state, and apply handler**

Inside `LibraryView`, after `const [dialogOpen, setDialogOpen] = useState(false);`, add:

```ts
  const gridRef = useRef<PhotoGridHandle>(null);
  const [labelError, setLabelError] = useState(false);

  async function applyLabel(label: ColorLabel | null) {
    const ids = sel.selected;
    setLabelError(false);
    try {
      const res = await fetch("/api/photos/color-label", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ photoIds: [...ids], label }),
      });
      if (!res.ok) throw new Error("label failed");
      // Optimistically repaint the client-fetched grid; selection stays so the
      // user sees the tint land and can re-pick.
      gridRef.current?.patchPhotos(ids, { colorLabel: label });
    } catch {
      setLabelError(true);
    }
  }
```

- [ ] **Step 3: Render the menu in the toolbar actions**

In the `SelectionToolbar` `actions`, add the menu next to the existing "Add to album" button. Replace the current `actions={ ... }` block with:

```tsx
          actions={
            <>
              <ColorLabelMenu
                disabled={sel.count === 0}
                onPick={(label) => void applyLabel(label)}
              />
              <Button size="sm" disabled={sel.count === 0} onClick={() => setDialogOpen(true)}>
                Add to album
              </Button>
            </>
          }
```

- [ ] **Step 4: Show the error and pass the ref to the grid**

Right after the closing of the `{sel.selectMode ? (...) : (...)}` block and before `<PhotoGrid ...>`, add the error line:

```tsx
      {labelError && (
        <p className="px-4 py-1 text-sm text-destructive">Failed to apply label.</p>
      )}
```

Add `apiRef={gridRef}` to the `<PhotoGrid>` element:

```tsx
      <PhotoGrid
        apiRef={gridRef}
        mode={mode}
        selectMode={sel.selectMode}
        selectedIds={sel.selected}
        onSelectionChange={sel.setSelected}
      />
```

- [ ] **Step 5: Lint + full test suite**

Run:

```bash
pnpm --filter @lumio/web lint
pnpm -r test
```

Expected: lint PASS; all package test suites PASS.

- [ ] **Step 6: Browser-verify the feature**

With `pnpm db:up` and `pnpm dev` running, signed in, on the Library page:

1. Switch grid to **Card** view (grid-view menu). Photos float on muted mats.
2. Click **Select**, choose several photos.
3. Click **Label ▾** → pick e.g. **Green**. The selected tiles' mats tint green **immediately**, and they stay selected.
4. Pick **Blue** for the same selection → mats switch to blue. Pick **None** → mats revert to muted.
5. Switch to **Fill** and **Fit** → no tint appears (labels are card-only).
6. **Reload** the page, return to Card view → the last-applied tint persists (DB round-trip via `toPhotoDTO`).
7. With nothing selected, the **Label** button is disabled.

- [ ] **Step 7: Commit**

```bash
git add "apps/web/src/app/(app)/photos/library-view.tsx"
git commit -m "feat(web): color-label flyout in Library selection toolbar"
```

---

## Task 10: Final verification

- [ ] **Step 1: Full test + lint + build**

Run:

```bash
pnpm -r test
pnpm --filter @lumio/web lint
pnpm --filter @lumio/web build
```

Expected: all PASS (build compiles the new route and components).

- [ ] **Step 2: Confirm the spec is fully covered**

Re-read `docs/superpowers/specs/2026-06-19-color-labels-design.md` and confirm: palette config (Task 1), DTO + enum column (Tasks 2–3), batch API + service (Tasks 4–5), optimistic repaint (Task 6), card tint (Task 7), toolbar flyout (Tasks 8–9). Non-goals (filtering, single-photo labeling, keyboard shortcuts, fill/fit indicators) remain unimplemented by design.

- [ ] **Step 3 (if a feature branch): open a PR**

Only if the user asks. Base `main`.

---

## Self-Review Notes

- **Spec coverage:** every spec section maps to a task (see Task 10 Step 2). The only intentional deviation: the card tint is applied via inline `style` overriding `bg-muted` rather than editing `cell-variants.ts` — simpler and keeps cva free of arbitrary hex, exactly as the spec's "cva can't take an arbitrary hex" note anticipated.
- **Type consistency:** `ColorLabel` (shared union from `colorLabelSchema`) flows unchanged through `PhotoDTO.colorLabel`, `toPhotoDTO` (cast from the Prisma enum), `setPhotoColorLabel(label: ColorLabel | null)`, `setColorLabelSchema`, `PhotoGridHandle.patchPhotos(Partial<PhotoDTO>)`, and `ColorLabelMenu.onPick(label: ColorLabel | null)`. `patchPhotos` is named identically in the hook, the handle type, and the call site.
- **No placeholders:** every code step contains complete, runnable content.
```
