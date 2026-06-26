# Selection Inspector Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A docked, Lightroom-style detail/inspector panel opened from the selection toolbar that shows + edits the selected photos' info without entering the lightbox — single photo → the full Info tab; many photos → live per-field bulk metadata editing.

**Architecture:** Extract the lightbox's Info-tab body into a shared `features/photo-info/` module (`PhotoInfoPanel`) so the lightbox and the inspector render the exact same thing. Generalize the upload page's already-built selection-bound editor into a shared `SelectionMetadataForm` for the bulk case. Compose them in a `SelectionInfoPanel` orchestrator (0/1/N), hosted in a reusable `SidePanel` chrome primitive, mounted as a `position: fixed` right column inside `PhotoCollectionProvider` in both the standard library view and the search view. **No DB/route/migration work** — the backend (`aggregatePhotoMetadataValues` + `bulkUpsertPhotoMetadataField` + `/metadata/selection`) already exists.

**Tech Stack:** Next.js (App Router) client components, React, shadcn UI (Button/Tooltip/Separator/Skeleton/Badge), Tailwind, `@lumio/shared`, existing `usePhotoCollection`/`useFeature`/`useCatalog` hooks.

> **Spec:** `docs/superpowers/specs/2026-06-26-selection-inspector-panel-design.md`
>
> **Testing note (follows the repo's established pattern):** this codebase unit-tests pure logic in `packages/*` (Vitest) and verifies React/UI via `tsc --noEmit` + a browser smoke pass — it does **not** unit-test presentational React components with provider/context dependencies (see the shipped `1f` plan and `features/lightbox/*`, which have no component tests). All backend logic here already exists and is tested. So each task's gate is `pnpm --filter @lumio/web exec tsc --noEmit` (clean) + a final browser smoke (Task 8). No new Vitest specs are warranted; adding heavily-mocked render tests would contradict the existing convention.

---

## File structure

**New**
- `apps/web/src/components/ui/side-panel.tsx` — reusable docked-panel chrome (fixed right column, header + scroll body).
- `apps/web/src/features/photo-info/standard-metadata.tsx` — moved from lightbox (verbatim).
- `apps/web/src/features/photo-info/metadata-field-row.tsx` — moved from lightbox (verbatim).
- `apps/web/src/features/photo-info/metadata-panel.tsx` — moved from lightbox (one import path changes).
- `apps/web/src/features/photo-info/info-rows.tsx` — extracted Source/created/modified/Hash rows.
- `apps/web/src/features/photo-info/album-membership.tsx` — extracted from `lightbox-sidebar.tsx` (verbatim function).
- `apps/web/src/features/photo-info/photo-info-panel.tsx` — composes the single-photo Info tab.
- `apps/web/src/features/photo-info/selection-metadata-form.tsx` — generalized from `UploadMetadataForm`.
- `apps/web/src/features/photo-info/selection-info-panel.tsx` — 0/1/N orchestrator.
- `apps/web/src/features/photo-info/inspector-toggle.tsx` — toolbar toggle button.
- `apps/web/src/features/photo-info/index.ts` — barrel.

**Modified**
- `apps/web/src/features/lightbox/lightbox-sidebar.tsx` — Info tab → `<PhotoInfoPanel>`; drop inline `AlbumMembership`/`Row`; keep EXIF + Edit.
- `apps/web/src/app/(app)/c/[catalog]/upload/upload-metadata-form.tsx` — thin re-export of `SelectionMetadataForm`.
- `apps/web/src/components/photo-library/photo-library-view.tsx` — `panelOpen` state, `pr-80` reflow, mount `SidePanel`/`SelectionInfoPanel`, add toggle.
- `apps/web/src/app/(app)/c/[catalog]/search/search-view.tsx` — same integration.

**Deleted (moved)**
- `apps/web/src/features/lightbox/standard-metadata.tsx`
- `apps/web/src/features/lightbox/metadata-panel.tsx`
- `apps/web/src/features/lightbox/metadata-field-row.tsx`

**Superseded**
- `docs/superpowers/plans/2026-06-26-photo-metadata-1f-bulk-fill.md` — annotated as superseded.

---

### Task 1: `SidePanel` chrome primitive

**Files:**
- Create: `apps/web/src/components/ui/side-panel.tsx`

- [ ] **Step 1: Write the component**

```tsx
import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/**
 * A right-docked, non-modal panel: fixed to the viewport's right edge, full
 * height, its own vertical scroll. Reusable chrome for any inspector — it knows
 * nothing about photos. The host reserves space for it (e.g. `pr-80` on the
 * content) so the panel sits beside the content rather than over it. Opaque +
 * `z-30` so it cleanly covers a sticky toolbar's full-bleed band underneath.
 */
export function SidePanel({
  title,
  onClose,
  className,
  children,
}: {
  title: React.ReactNode;
  onClose: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <aside
      className={cn(
        "fixed top-0 right-0 z-30 flex h-dvh w-80 flex-col border-l bg-background",
        className,
      )}
    >
      <div className="flex shrink-0 items-center justify-between border-b px-3 py-2">
        <span className="text-sm font-semibold">{title}</span>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close panel">
          <X aria-hidden />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
    </aside>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: clean (no errors).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ui/side-panel.tsx
git commit -m "feat(ui): SidePanel — reusable docked detail-panel chrome"
```

---

### Task 2: Extract the shared single-photo Info tab into `features/photo-info/`

This is the largest task: move three lightbox files verbatim, extract two pieces out of `lightbox-sidebar.tsx`, compose them, and repoint the lightbox at the new shared component. Work top-down so each new file's imports resolve before the lightbox edit.

**Files:**
- Create: `apps/web/src/features/photo-info/standard-metadata.tsx`
- Create: `apps/web/src/features/photo-info/metadata-field-row.tsx`
- Create: `apps/web/src/features/photo-info/metadata-panel.tsx`
- Create: `apps/web/src/features/photo-info/info-rows.tsx`
- Create: `apps/web/src/features/photo-info/album-membership.tsx`
- Create: `apps/web/src/features/photo-info/photo-info-panel.tsx`
- Create: `apps/web/src/features/photo-info/index.ts`
- Delete: `apps/web/src/features/lightbox/standard-metadata.tsx`
- Delete: `apps/web/src/features/lightbox/metadata-panel.tsx`
- Delete: `apps/web/src/features/lightbox/metadata-field-row.tsx`
- Modify: `apps/web/src/features/lightbox/lightbox-sidebar.tsx`

- [ ] **Step 1: Move `standard-metadata.tsx` (verbatim)**

```bash
git mv apps/web/src/features/lightbox/standard-metadata.tsx apps/web/src/features/photo-info/standard-metadata.tsx
```

Its content is unchanged — it imports only `lucide-react` and `@lumio/shared`, no lightbox-relative imports.

- [ ] **Step 2: Move `metadata-field-row.tsx` (verbatim)**

```bash
git mv apps/web/src/features/lightbox/metadata-field-row.tsx apps/web/src/features/photo-info/metadata-field-row.tsx
```

Its imports (`@/components/metadata/metadata-value-input`, `@/lib/catalog-api`, `@lumio/shared`) are absolute and still resolve. No edit needed.

- [ ] **Step 3: Move `metadata-panel.tsx` and fix its one relative import**

```bash
git mv apps/web/src/features/lightbox/metadata-panel.tsx apps/web/src/features/photo-info/metadata-panel.tsx
```

Then change its schema-hook import from the now-sibling-less relative path to the absolute lightbox path (the hook stays in `features/lightbox/` — it's shared by the search filter panel and upload form too). The `./metadata-field-row` import is unchanged (that file moved alongside).

In `apps/web/src/features/photo-info/metadata-panel.tsx`, replace:

```tsx
import { useCatalogMetadataSchema } from "./use-metadata-schema";
```

with:

```tsx
import { useCatalogMetadataSchema } from "@/features/lightbox/use-metadata-schema";
```

(Leave `import { MetadataValueField } from "./metadata-field-row";` as-is.)

- [ ] **Step 4: Create `info-rows.tsx` (extracted Source/created/modified/Hash + the `Row` helper)**

```tsx
import type { ReactNode } from "react";
import type { PhotoDTO } from "@lumio/shared";
import { Badge } from "@/components/ui/badge";

/** The fixed per-photo facts shown in the Info tab. */
export function InfoRows({ photo }: { photo: PhotoDTO }) {
  return (
    <div className="space-y-3">
      <Row label="Source" value={<Badge>{photo.source}</Badge>} />
      <Row label="File created" value={photo.fileCreatedAt ?? "—"} />
      <Row label="File modified" value={photo.fileModifiedAt ?? "—"} />
      <Row label="Hash" value={photo.hash ?? "—"} />
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="truncate text-right">{value}</span>
    </div>
  );
}
```

- [ ] **Step 5: Create `album-membership.tsx` (verbatim extraction of the `AlbumMembership` function from `lightbox-sidebar.tsx`, with its own imports + an `export`)**

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, X } from "lucide-react";
import type { AlbumSummaryDTO, PhotoDTO } from "@lumio/shared";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useLibraryTree } from "@/components/library-tree/library-tree";
import {
  AlbumPickerItems,
  AlbumThumb,
} from "@/components/photo-actions/album-picker-items";
import { useAddToAlbum } from "@/components/photo-actions/use-add-to-album";
import { catalogApiUrl } from "@/lib/catalog-api";
import { useCatalog } from "@/components/providers/catalog-context";
import { removePhotoFromAlbum } from "@/lib/photo-mutations";
import { usePhotoCollection } from "@/features/photo-grid";

/** "Appears in" — the photo's album membership, with inline add/remove. Loads
 *  the photo's full DTO to learn membership (grid photos carry no albumIds). */
export function AlbumMembership({ photo }: { photo: PhotoDTO }) {
  const { slug } = useCatalog();
  const { patchPhotos } = usePhotoCollection();
  const { albums, loading: treeLoading } = useLibraryTree();
  const { addToAlbum, addToAlbumDirect, element } = useAddToAlbum();
  const [pending, setPending] = useState(false);
  // Null until the photo's full DTO loads (the grid photo carries no albumIds).
  const [albumIds, setAlbumIds] = useState<string[] | null>(
    photo.albumIds ?? null,
  );

  // Learn this photo's current membership.
  useEffect(() => {
    let alive = true;
    fetch(catalogApiUrl(slug, `/photos/${photo.id}`))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status} ${r.url}`))))
      .then((data: PhotoDTO) => {
        if (alive) setAlbumIds(data.albumIds ?? []);
      })
      .catch(() => {
        /* leave membership unknown on failure */
      });
    return () => {
      alive = false;
    };
  }, [slug, photo.id]);

  // Re-read membership from the server and sync the grid store. Used after the
  // "New album…" dialog adds the photo (the dialog doesn't return the new id).
  const resync = useCallback(() => {
    fetch(catalogApiUrl(slug, `/photos/${photo.id}`))
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`${r.status} ${r.url}`))))
      .then((data: PhotoDTO) => {
        const next = data.albumIds ?? [];
        setAlbumIds(next);
        patchPhotos(new Set([photo.id]), { albumIds: next });
      })
      .catch(() => {
        /* leave membership as-is on failure */
      });
  }, [slug, photo.id, patchPhotos]);

  // Add to an existing album via the shared quick-pick (POST + sound + refresh),
  // then optimistically reflect it locally and in the grid store.
  function add(albumId: string) {
    // `next` is captured from this render's albumIds. Safe: the dropdown closes
    // after every pick, so the next "Add more" open re-renders with fresh state
    // before another add can be issued.
    const next = [...(albumIds ?? []), albumId];
    void addToAlbumDirect([photo.id], albumId, {
      onSuccess: () => {
        setAlbumIds(next);
        patchPhotos(new Set([photo.id]), { albumIds: next });
      },
    });
  }

  async function remove(albumId: string) {
    if (pending) return;
    const next = (albumIds ?? []).filter((id) => id !== albumId);
    setPending(true);
    try {
      await removePhotoFromAlbum(slug, albumId, photo.id);
      // Only commit once the server confirms, so a failed delete can't leave
      // phantom membership in the UI or the shared grid store.
      setAlbumIds(next);
      patchPhotos(new Set([photo.id]), { albumIds: next });
    } catch {
      toast.error("Failed to update album.");
    } finally {
      setPending(false);
    }
  }

  const byId = new Map(albums.map((a) => [a.id, a]));
  const memberAlbums = (albumIds ?? [])
    .map((id) => byId.get(id))
    .filter((a): a is AlbumSummaryDTO => a !== undefined && !a.isSmart)
    .sort((a, b) => a.name.localeCompare(b.name));
  // Skeleton while membership is unknown, or while a photo known to be in some
  // albums waits for the tree to resolve their names. An empty membership needs
  // no tree, so it shows the empty state immediately.
  const loading =
    albumIds === null ||
    (albumIds.length > 0 && treeLoading && albums.length === 0);

  return (
    <div>
      <p className="mb-2 font-medium">Appears in</p>
      {loading ? (
        <div>
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-2.5 px-3 py-2">
              <Skeleton className="size-6 rounded-md" />
              <Skeleton className="h-4 w-32 rounded" />
            </div>
          ))}
        </div>
      ) : memberAlbums.length === 0 ? (
        <p className="text-muted-foreground">Not in any album yet</p>
      ) : (
        <div>
          {memberAlbums.map((album) => (
            // Match the album-picker DropdownMenuItem 1:1 (gap-2.5, rounded-xl,
            // px-3 py-2, text-sm, accent hover) so the lightbox list and the
            // "Add more" menu read as the same control.
            <div
              key={album.id}
              className="group/row relative flex cursor-default items-center gap-2.5 rounded-xl px-3 py-2 text-sm transition-colors select-none hover:bg-accent hover:text-accent-foreground"
            >
              <AlbumThumb coverPhotoId={album.coverPhotoId} />
              <span className="truncate">{album.name}</span>
              <button
                type="button"
                disabled={pending}
                onClick={() => void remove(album.id)}
                aria-label={`Remove from ${album.name}`}
                className="-mr-1 ml-auto rounded-md p-1 text-muted-foreground opacity-0 transition hover:text-foreground focus-visible:opacity-100 group-hover/row:opacity-100"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
          ))}
        </div>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            disabled={albumIds === null}
            className="mt-2 w-full"
          >
            <Plus aria-hidden />
            Add more
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-56">
          <AlbumPickerItems
            menu={{
              Item: DropdownMenuItem,
              Separator: DropdownMenuSeparator,
              Sub: DropdownMenuSub,
              SubTrigger: DropdownMenuSubTrigger,
              SubContent: DropdownMenuSubContent,
            }}
            excludeAlbumIds={new Set(albumIds ?? [])}
            onPick={(albumId) => add(albumId)}
            onCreateNew={() => addToAlbum([photo.id], { onSuccess: resync })}
          />
        </DropdownMenuContent>
      </DropdownMenu>
      {element}
    </div>
  );
}
```

- [ ] **Step 6: Create `photo-info-panel.tsx` (the composed single-photo Info tab — the shared source of truth)**

```tsx
"use client";

import { FeatureKey, type PhotoDTO } from "@lumio/shared";
import { Separator } from "@/components/ui/separator";
import { FeatureGate } from "@/components/features/features-provider";
import { StandardMetadata } from "./standard-metadata";
import { InfoRows } from "./info-rows";
import { MetadataPanel } from "./metadata-panel";
import { AlbumMembership } from "./album-membership";

/**
 * The single-photo "Info" view — the shared body of the lightbox Info tab and
 * the selection inspector (when exactly one photo is selected). Owns its own
 * vertical rhythm so any host can drop it in unwrapped. Redesign it here and it
 * changes everywhere it's shown.
 */
export function PhotoInfoPanel({ photo }: { photo: PhotoDTO }) {
  return (
    <div className="space-y-4">
      <FeatureGate feature={FeatureKey.StandardMetadata}>
        <StandardMetadata exif={photo.exif} />
        <Separator />
      </FeatureGate>
      <InfoRows photo={photo} />
      <FeatureGate feature={FeatureKey.Metadata}>
        <Separator />
        {/* Keyed on photo.id so values re-init per photo during arrow-key nav. */}
        <MetadataPanel key={photo.id} photo={photo} />
      </FeatureGate>
      <Separator />
      <AlbumMembership key={photo.id} photo={photo} />
    </div>
  );
}
```

- [ ] **Step 7: Create the barrel `index.ts`**

```ts
export { PhotoInfoPanel } from "./photo-info-panel";
```

- [ ] **Step 8: Repoint the lightbox at `PhotoInfoPanel`** — replace the **entire** contents of `apps/web/src/features/lightbox/lightbox-sidebar.tsx` with:

```tsx
"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import type { PhotoDTO } from "@lumio/shared";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { exifEntries, filterExifEntries } from "@/lib/exif-entries";
import { usePhotoCollection } from "@/features/photo-grid";
import { LightboxEditPanel } from "@/features/photo-editor";
import { LightboxTab } from "@/lib/lightbox-tab";
import { PhotoInfoPanel } from "@/features/photo-info";

export function LightboxSidebar({ photo }: { photo: PhotoDTO }) {
  // Controlled by the shared collection state so the i/e keyboard shortcuts can
  // drive the tab from the lightbox-level keyboard handler.
  const { openTab, setOpenTab } = usePhotoCollection();
  const metadata = exifEntries(photo.exif);

  return (
    <aside className="w-full shrink-0 border-t bg-background text-sm lg:flex lg:h-dvh lg:w-80 lg:flex-col lg:overflow-hidden lg:border-t-0 lg:border-l">
      <Tabs
        value={openTab}
        onValueChange={(v) => setOpenTab(v as LightboxTab)}
        className="gap-0 lg:min-h-0 lg:flex-1"
      >
        <div className="flex shrink-0 items-center border-b px-3 py-2">
          <TabsList className="w-full">
            <TabsTrigger value={LightboxTab.Info}>
              Info
              <Kbd className="h-4 min-w-4 px-1 text-[10px]">i</Kbd>
            </TabsTrigger>
            <TabsTrigger value={LightboxTab.Edit}>
              Edit
              <Kbd className="h-4 min-w-4 px-1 text-[10px]">e</Kbd>
            </TabsTrigger>
            <TabsTrigger value={LightboxTab.Exif}>EXIF</TabsTrigger>
          </TabsList>
        </div>

        <div className="p-4 lg:flex lg:min-h-0 lg:flex-1 lg:flex-col lg:overflow-y-auto">
          <TabsContent value={LightboxTab.Info}>
            <PhotoInfoPanel photo={photo} />
          </TabsContent>

          <TabsContent value={LightboxTab.Edit} className="lg:flex lg:flex-col">
            <LightboxEditPanel />
          </TabsContent>

          <TabsContent value={LightboxTab.Exif}>
            <ExifPanel entries={metadata} />
          </TabsContent>
        </div>
      </Tabs>
    </aside>
  );
}

function ExifPanel({ entries }: { entries: Array<[string, string]> }) {
  const [query, setQuery] = useState("");
  const filtered = filterExifEntries(entries, query);
  return (
    <div className="space-y-3">
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search metadata"
          aria-label="Search metadata"
          className="pl-9"
        />
      </div>
      {entries.length === 0 ? (
        <p className="text-xs text-muted-foreground">No metadata</p>
      ) : filtered.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No metadata matches &ldquo;{query}&rdquo;.
        </p>
      ) : (
        <dl className="space-y-1 text-xs">
          {filtered.map(([key, value]) => (
            <div key={key} className="flex justify-between gap-3">
              <dt className="shrink-0 text-muted-foreground">{key}</dt>
              <dd className="min-w-0 break-all text-right font-mono">
                {value}
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
```

- [ ] **Step 9: Typecheck** — this catches any other importer of the three moved files.

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: clean. If an error points at an import of `@/features/lightbox/standard-metadata`, `.../metadata-panel`, or `.../metadata-field-row` elsewhere, repoint it to `@/features/photo-info/...` and re-run. (As of this writing, only `lightbox-sidebar.tsx` imports them.)

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/features/photo-info apps/web/src/features/lightbox/lightbox-sidebar.tsx
git commit -m "refactor(photo-info): extract lightbox Info tab into shared PhotoInfoPanel"
```

---

### Task 3: Generalize the bulk editor → `SelectionMetadataForm`

The upload page's `UploadMetadataForm` is already a selection-bound, Mixed-aware, live-per-field editor. Move it into `features/photo-info/` as `SelectionMetadataForm` (verbatim behavior) and make the upload module a thin re-export, so both the upload page and the inspector share one implementation.

**Files:**
- Create: `apps/web/src/features/photo-info/selection-metadata-form.tsx`
- Modify: `apps/web/src/app/(app)/c/[catalog]/upload/upload-metadata-form.tsx`
- Modify: `apps/web/src/features/photo-info/index.ts`

- [ ] **Step 1: Create `selection-metadata-form.tsx`** with the exact current implementation (component renamed `UploadMetadataForm` → `SelectionMetadataForm`; the inner `SelectionMetadataField` unchanged). Paths are absolute and still resolve from the new location.

```tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { MetadataFieldDef } from "@lumio/shared";
import { useCatalogMetadataSchema } from "@/features/lightbox/use-metadata-schema";
import { useCatalog } from "@/components/providers/catalog-context";
import { MetadataValueInput } from "@/components/metadata/metadata-value-input";
import { MetadataFieldsList } from "@/components/metadata/metadata-fields-list";
import { Skeleton } from "@/components/ui/skeleton";
import { postJson } from "@/lib/http";
import { catalogApiUrl } from "@/lib/catalog-api";
import { cn } from "@/lib/utils";

type Aggregated = Record<string, { value: string; mixed: boolean }>;

/**
 * Selection-bound metadata editor. Mirrors the grid selection like Lightroom's
 * metadata panel: loads the selected photos' stored values, shows the shared
 * value (or "Mixed" when they differ), and commits each edit to every selected
 * photo. Nothing is a shared scratchpad — re-selecting a photo always shows what
 * was actually saved to it. Shared by the upload page and the grid inspector.
 */
export function SelectionMetadataForm({ selectedIds }: { selectedIds: Set<string> }) {
  const { slug } = useCatalog();
  const schema = useCatalogMetadataSchema(slug);
  // Stable signature of the selection — drives reloads and is split back to ids.
  const selKey = [...selectedIds].sort().join(",");
  const noSelection = selectedIds.size === 0;

  // Aggregated values tagged with the selection they were loaded for. While the
  // tag doesn't match the current selection the panel is "loading" (skeletons) —
  // derived, so the effect never has to reset state synchronously.
  const [loaded, setLoaded] = useState<{ key: string; values: Aggregated } | null>(null);
  const loading = !noSelection && loaded?.key !== selKey;

  useEffect(() => {
    if (!selKey) return;
    let alive = true;
    postJson(catalogApiUrl(slug, "/metadata/selection"), { photoIds: selKey.split(",") })
      .then((r) => r.json() as Promise<{ values: Aggregated }>)
      .then((d) => {
        if (alive) setLoaded({ key: selKey, values: d.values ?? {} });
      })
      .catch(() => {
        if (alive) setLoaded({ key: selKey, values: {} });
      });
    return () => {
      alive = false;
    };
  }, [selKey, slug]);

  const groups = (schema ?? [])
    .map((g) => ({ ...g, fields: g.fields.filter((f) => f.enabled) }))
    .filter((g) => g.fields.length > 0);
  if (groups.length === 0) return null;

  return (
    <div className="space-y-4">
      <div>
        <p className="font-medium">Metadata</p>
        <p className="text-xs text-muted-foreground">
          {noSelection
            ? "Select photos to fill in metadata."
            : `Editing ${selectedIds.size} selected photo${selectedIds.size === 1 ? "" : "s"}. Changes apply to all.`}
        </p>
      </div>
      <fieldset disabled={noSelection} className={cn(noSelection && "opacity-50")}>
        <MetadataFieldsList
          groups={groups}
          renderValue={(field) => {
            // Nothing selected: show inert placeholders (the fieldset disables them).
            if (noSelection) {
              return (
                <MetadataValueInput
                  slug={slug}
                  fieldId={field.id}
                  type={field.type}
                  options={field.options}
                  suggests={field.suggests}
                  value=""
                  onChange={() => {}}
                />
              );
            }
            if (loading || !loaded) return <Skeleton className="h-7 w-40" />;
            // Keyed by selection so switching photos remounts with fresh values.
            return (
              <SelectionMetadataField
                key={`${selKey}:${field.id}`}
                slug={slug}
                photoIds={selKey.split(",")}
                field={field}
                initial={loaded.values[field.id]}
              />
            );
          }}
        />
      </fieldset>
    </div>
  );
}

/**
 * One field's value slot bound to a selection of photos. Seeded from the
 * aggregated load — a shared value, or empty with a "Mixed" placeholder when the
 * photos disagree. Editing commits to every selected photo. A mixed field is
 * only written once the user actually types: blurring it untouched must never
 * overwrite the differing values with empty.
 */
function SelectionMetadataField({
  slug,
  photoIds,
  field,
  initial,
}: {
  slug: string;
  photoIds: string[];
  field: MetadataFieldDef;
  initial?: { value: string; mixed: boolean };
}) {
  const startMixed = initial?.mixed ?? false;
  const [value, setValue] = useState(initial?.value ?? "");
  const saved = useRef(initial?.value ?? "");
  const mixed = useRef(startMixed);

  async function save(next: string = value) {
    if (mixed.current) {
      if (next.trim() === "") return; // never wipe differing values on a bare blur
    } else if (next === saved.current) {
      return; // unchanged
    }
    saved.current = next;
    mixed.current = false;
    try {
      await postJson(
        catalogApiUrl(slug, "/metadata/selection"),
        { photoIds, fieldId: field.id, value: next },
        "PUT",
      );
    } catch {
      toast.error("Failed to save metadata.");
    }
  }

  return (
    <MetadataValueInput
      slug={slug}
      fieldId={field.id}
      type={field.type}
      options={field.options}
      suggests={field.suggests}
      value={value}
      placeholder={startMixed ? "Mixed" : "—"}
      onChange={setValue}
      onCommit={save}
    />
  );
}
```

- [ ] **Step 2: Replace `upload-metadata-form.tsx` with a thin re-export** (keeps the upload page's `import { UploadMetadataForm } from "./upload-metadata-form"` working, unchanged).

```tsx
"use client";

// The upload page's metadata editor is the shared selection-bound form. Kept as
// a named re-export so the upload client's existing import stays valid.
export { SelectionMetadataForm as UploadMetadataForm } from "@/features/photo-info/selection-metadata-form";
```

- [ ] **Step 3: Extend the barrel** — replace `apps/web/src/features/photo-info/index.ts` with:

```ts
export { PhotoInfoPanel } from "./photo-info-panel";
export { SelectionMetadataForm } from "./selection-metadata-form";
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/photo-info/selection-metadata-form.tsx apps/web/src/features/photo-info/index.ts "apps/web/src/app/(app)/c/[catalog]/upload/upload-metadata-form.tsx"
git commit -m "refactor(photo-info): share the selection-bound bulk metadata editor (upload + inspector)"
```

---

### Task 4: Orchestrator + toolbar toggle

**Files:**
- Create: `apps/web/src/features/photo-info/selection-info-panel.tsx`
- Create: `apps/web/src/features/photo-info/inspector-toggle.tsx`
- Modify: `apps/web/src/features/photo-info/index.ts`

- [ ] **Step 1: Create `selection-info-panel.tsx`** — the 0/1/N switch. Reads photos from the collection context (never `gridRef` during render). For one selection it resolves the loaded `PhotoDTO` via `getPhotos`; for many it renders the shared bulk form.

```tsx
"use client";

import { usePhotoCollection } from "@/features/photo-grid";
import { Skeleton } from "@/components/ui/skeleton";
import { PhotoInfoPanel } from "./photo-info-panel";
import { SelectionMetadataForm } from "./selection-metadata-form";

/**
 * The inspector body. Switches on selection size:
 *  - 0  → a muted empty hint (the panel persists, it doesn't yank shut).
 *  - 1  → the full single-photo Info tab (identical to the lightbox).
 *  - 2+ → the live, Mixed-aware bulk metadata editor (writes to all selected).
 * `getPhotos` is reactive on the grid store, so the single-photo view fills in
 * as soon as the selected tile is loaded.
 */
export function SelectionInfoPanel({ selectedIds }: { selectedIds: Set<string> }) {
  const { getPhotos } = usePhotoCollection();
  const ids = [...selectedIds];

  if (ids.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">
        Select photos to see details
      </p>
    );
  }

  if (ids.length === 1) {
    const photo = getPhotos(new Set(ids))[0];
    if (!photo) {
      return (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-7 w-full" />
          ))}
        </div>
      );
    }
    return <PhotoInfoPanel photo={photo} />;
  }

  return <SelectionMetadataForm selectedIds={selectedIds} />;
}
```

- [ ] **Step 2: Create `inspector-toggle.tsx`** — the toolbar button that flips the panel.

```tsx
"use client";

import { PanelRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

/** Selection-toolbar button that opens/closes the detail inspector. */
export function InspectorToggle({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={open ? "secondary" : "outline"}
          size="icon-sm"
          aria-pressed={open}
          onClick={onToggle}
          aria-label="Toggle details panel"
        >
          <PanelRight aria-hidden />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Details</TooltipContent>
    </Tooltip>
  );
}
```

- [ ] **Step 3: Extend the barrel** — replace `apps/web/src/features/photo-info/index.ts` with:

```ts
export { PhotoInfoPanel } from "./photo-info-panel";
export { SelectionMetadataForm } from "./selection-metadata-form";
export { SelectionInfoPanel } from "./selection-info-panel";
export { InspectorToggle } from "./inspector-toggle";
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/photo-info/selection-info-panel.tsx apps/web/src/features/photo-info/inspector-toggle.tsx apps/web/src/features/photo-info/index.ts
git commit -m "feat(photo-info): selection inspector orchestrator + toolbar toggle"
```

---

### Task 5: Wire the inspector into `PhotoLibraryView`

Add a `panelOpen` state, reserve right space with `pr-80` when open, mount the `SidePanel` (with the orchestrator) **inside** `PhotoCollectionProvider`, and add the toggle to the selection toolbar.

**Files:**
- Modify: `apps/web/src/components/photo-library/photo-library-view.tsx`

- [ ] **Step 1: Add imports** near the existing imports:

```tsx
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { SidePanel } from "@/components/ui/side-panel";
import { SelectionInfoPanel, InspectorToggle } from "@/features/photo-info";
```

(The file already imports `useRef, useState` from React — extend that existing line rather than duplicating; `cn` may already be imported. Don't create duplicate imports.)

- [ ] **Step 2: Add the panel state** — inside `PhotoLibraryView`, alongside the other `useState` hooks (e.g. just after `const [anySelectedEdited, setAnySelectedEdited] = useState(false);`):

```tsx
  const [panelOpen, setPanelOpen] = useState(false);
```

- [ ] **Step 3: Wrap the returned tree with the reflow container + mount the panel.** Replace the entire `return ( ... )` block with:

```tsx
  return (
    <>
      {actions.element}
      <div className={cn("transition-[padding] duration-300", panelOpen && "pr-80")}>
        {sel.count > 0 ? (
          <SelectionToolbar
            title={title}
            count={sel.count}
            totalLabel={totalLabel}
            onCancel={sel.clear}
            actions={
              <>
                <InspectorToggle open={panelOpen} onToggle={() => setPanelOpen((o) => !o)} />
                {selectionActions?.({
                  actions,
                  selectedIds: sel.selected,
                  clearSelection: sel.clear,
                })}
                <SelectionActions
                  actions={actions}
                  selectedIds={sel.selected}
                  gridRef={gridRef}
                  clearSelection={sel.clear}
                  clearOnFavorite={!!actionOptions?.dropOnUnfavorite}
                  anyEdited={anySelectedEdited}
                />
              </>
            }
          />
        ) : (
          <HeaderBar
            title={title}
            subtitle={countSubtitle}
            actions={
              <>
                {headerActions}
                <GridViewMenu mode={mode} onModeChange={setMode} />
                <GridSizeMenu columns={columns} onColumnsChange={setColumns} />
                <GridSortMenu sort={sort} onSortChange={setSort} />
                {calendar && (
                  <GridCalendarMenu
                    facetsEndpoint={calendar.facetsEndpoint}
                    value={month}
                    onChange={setMonth}
                  />
                )}
              </>
            }
          />
        )}

        <PhotoCollectionProvider
          key={src.key}
          endpoint={src.endpoint}
          params={src.params}
          urlForId={src.urlForId}
          baseUrl={src.baseUrl}
        >
          <CollectionTotalReporter onTotal={setTotal} />
          <SelectionEditReporter selectedIds={sel.selected} onAnyEdited={setAnySelectedEdited} />
          <PhotoActionsProvider value={actions}>
            {aboveGrid}
            <PhotoGrid
              apiRef={gridRef}
              mode={mode}
              columns={columns}
              selectedIds={sel.selected}
              onSelectionChange={sel.setSelected}
              empty={empty}
            />
            <Lightbox />
            <GridShortcuts selectedIds={sel.selected} />
          </PhotoActionsProvider>
          {panelOpen && (
            <SidePanel
              title={sel.count > 1 ? `${sel.count} selected` : "Details"}
              onClose={() => setPanelOpen(false)}
            >
              <SelectionInfoPanel selectedIds={sel.selected} />
            </SidePanel>
          )}
        </PhotoCollectionProvider>
      </div>
    </>
  );
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/photo-library/photo-library-view.tsx
git commit -m "feat(library): docked selection inspector in the standard photo views"
```

---

### Task 6: Wire the inspector into `search-view.tsx`

Same pattern, adapted to the search view's bespoke layout: `panelOpen` state, `pr-80` on the outer reflow wrapper, toggle in the selection branch, panel mounted inside the (conditionally-rendered) `PhotoCollectionProvider`.

**Files:**
- Modify: `apps/web/src/app/(app)/c/[catalog]/search/search-view.tsx`

- [ ] **Step 1: Add imports** alongside the existing ones:

```tsx
import { SidePanel } from "@/components/ui/side-panel";
import { SelectionInfoPanel, InspectorToggle } from "@/features/photo-info";
```

(`cn` and `useState` are already imported in this file.)

- [ ] **Step 2: Add the panel state** — inside `SearchView`, near the other `useState` hooks (e.g. after `const [anySelectedEdited, setAnySelectedEdited] = useState(false);`):

```tsx
  const [panelOpen, setPanelOpen] = useState(false);
```

- [ ] **Step 3: Reserve right space on the outer wrapper.** Change the outer `<div>`'s className (currently `cn("transition-[padding] duration-500 ease-out", active ? "pt-0" : "pt-[32vh]")`) to also include the reflow padding:

```tsx
      <div
        className={cn(
          // Center the box on entry by padding the top; collapse the padding when
          // active so it rises to the top. Animating padding (not a transform) keeps
          // the box in flow, so its sticky header band never sweeps over the grid.
          "transition-[padding] duration-500 ease-out",
          active ? "pt-0" : "pt-[32vh]",
          panelOpen && "pr-80",
        )}
      >
```

- [ ] **Step 4: Add the toggle to the selection branch.** In the `sel.count > 0` branch of the inline toolbar, add `<InspectorToggle ... />` before `<SelectionActions ... />`:

```tsx
                  {sel.count > 0 ? (
                    <>
                      <InspectorToggle open={panelOpen} onToggle={() => setPanelOpen((o) => !o)} />
                      <SelectionActions
                        actions={actions}
                        selectedIds={sel.selected}
                        gridRef={gridRef}
                        clearSelection={sel.clear}
                        anyEdited={anySelectedEdited}
                      />
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="outline"
                            size="icon-sm"
                            onClick={sel.clear}
                            aria-label="Cancel"
                          >
                            <X aria-hidden />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Cancel</TooltipContent>
                      </Tooltip>
                    </>
                  ) : (
```

- [ ] **Step 5: Mount the panel inside the provider.** In the `<PhotoCollectionProvider>...</PhotoCollectionProvider>` block, add the panel right after the closing `</PhotoActionsProvider>` (still inside the provider):

```tsx
                <PhotoActionsProvider value={actions}>
                  <SelectionEditReporter selectedIds={sel.selected} onAnyEdited={setAnySelectedEdited} />
                  <PhotoGrid
                    apiRef={gridRef}
                    mode={mode}
                    columns={columns}
                    selectedIds={sel.selected}
                    onSelectionChange={sel.setSelected}
                    empty={<SearchEmpty />}
                  />
                  <Lightbox />
                  <GridShortcuts selectedIds={sel.selected} />
                </PhotoActionsProvider>
                {panelOpen && (
                  <SidePanel
                    title={sel.count > 1 ? `${sel.count} selected` : "Details"}
                    onClose={() => setPanelOpen(false)}
                  >
                    <SelectionInfoPanel selectedIds={sel.selected} />
                  </SidePanel>
                )}
              </PhotoCollectionProvider>
```

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add "apps/web/src/app/(app)/c/[catalog]/search/search-view.tsx"
git commit -m "feat(search): docked selection inspector in the search view"
```

---

### Task 7: Mark the `1f` dialog plan superseded

The inspector replaces the dialog-based bulk-fill approach. Annotate (don't silently delete) the old plan so the history is clear.

**Files:**
- Modify: `docs/superpowers/plans/2026-06-26-photo-metadata-1f-bulk-fill.md`

- [ ] **Step 1: Prepend a superseded banner** to the top of the file (above the existing `# Photo Metadata 1f …` heading):

```markdown
> **⚠️ SUPERSEDED (2026-06-26)** by `2026-06-26-selection-inspector-panel.md`.
> Bulk-fill is delivered by the docked **selection inspector** (live per-field
> across the selection via the existing `/metadata/selection` route), not by the
> dialog + new `/metadata/bulk` route described below. Do not implement this plan.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/plans/2026-06-26-photo-metadata-1f-bulk-fill.md
git commit -m "docs(metadata): mark 1f bulk-fill dialog plan superseded by the inspector"
```

---

### Task 8: Final verification + browser smoke

**Files:** none (verification only).

- [ ] **Step 1: Full web typecheck**

Run: `pnpm --filter @lumio/web exec tsc --noEmit`
Expected: clean.

- [ ] **Step 2: Lint the touched files** (the repo's React-Compiler lint is a real gate — refs-in-effect, no `gridRef` reads during render, `"use client"` first line).

Run: `pnpm --filter @lumio/web lint`
Expected: no new errors in `features/photo-info/*`, `components/ui/side-panel.tsx`, `photo-library-view.tsx`, `search-view.tsx`.

- [ ] **Step 3: Browser smoke** (dev server already runs per the project workflow; verify in-browser):
  - Library view, **1 selected** → click the **Details** toggle → inspector docks on the right, grid reflows (not covered); the body matches the lightbox Info tab (standard EXIF summary, Source/created/modified/Hash, custom fields, "Appears in"). Edit a custom field → open that photo in the lightbox → the value is there (shared component, shared save).
  - **Select a roll (N≥2)** → inspector shows the bulk editor ("Editing N selected…"); set Film Stock → all N get it (verify by opening two of them). A field where the photos differ shows the **Mixed** placeholder; blurring it untouched does **not** wipe their values.
  - **Add to selection / change selection** while open → inspector live-updates (1↔N modes swap; bulk fields reload aggregates).
  - **Clear selection** with the panel open → inspector persists showing "Select photos to see details"; the **X** closes it.
  - **Metadata feature OFF** (a catalog without it) → no custom-field section; single-photo Info still shows standard rows + album membership; nothing crashes.
  - Repeat the toggle + single + bulk flows in the **Search view** after running a query.
  - Lightbox still opens with working **i/e** tab shortcuts and the **EXIF** tab.

- [ ] **Step 4: (If anything failed)** fix forward with a focused commit; otherwise the feature is complete.

---

## Self-review

**Spec coverage**
- Docked, non-modal, live-updating panel → Task 1 (`SidePanel`, fixed col) + Tasks 5/6 (`pr-80` reflow, mounted in provider, live `selectedIds`). ✓
- Two modes (1 = full Info tab; 2+ = bulk) → Task 4 orchestrator. ✓
- Live per-field bulk (decision B) → Task 3 reuses the existing `SelectionMetadataForm`/`PUT /metadata/selection`. ✓
- Shared Info tab (lightbox + inspector, one source of truth) → Task 2 `PhotoInfoPanel`, lightbox repointed. ✓
- Reusable panel/layout scaffolding → `SidePanel` (Task 1) + `InspectorToggle` (Task 4). ✓
- All views incl. search → Tasks 5 (PhotoLibraryView covers library/albums/favorites/folders) + 6 (search). ✓
- Empty-state persistence on clear → orchestrator 0-branch + panel stays mounted. ✓
- No DB/route/migration; `1f` superseded → Task 7; backend untouched. ✓
- Bulk = metadata only (no album membership) → orchestrator routes 2+ to `SelectionMetadataForm` only. ✓

**Placeholder scan:** none — every new file's full content is given; edits show the full replacement blocks.

**Type consistency:** `SelectionInfoPanel({ selectedIds: Set<string> })`, `SelectionMetadataForm({ selectedIds: Set<string> })`, `InspectorToggle({ open, onToggle })`, `SidePanel({ title, onClose, className?, children })`, `PhotoInfoPanel({ photo: PhotoDTO })` — names/signatures match across the barrel and all call sites in Tasks 5/6. `getPhotos(ids: Set<string>): PhotoDTO[]` matches the `usePhotoCollection` contract. The upload re-export keeps the `UploadMetadataForm` name the upload client imports.
