# Grid keyboard shortcuts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `f` (toggle favourite over the selection), `Enter` (open the single selected photo on the Info tab), and `e` (open it on the Edit tab) keyboard shortcuts to all five photo-grid views.

**Architecture:** A pure, unit-tested decision function (`resolveGridShortcut`) decides what a keypress should do given the selection size and context guards. A thin client component (`GridShortcuts`) installs one document `keydown` listener, computes the context booleans, calls the pure function, and dispatches via the existing `usePhotoCollection().open` and `usePhotoActionsContext().favorite`. Opening on a specific tab is threaded through the existing `open(index)` path via an optional `{ tab }` argument.

**Tech Stack:** Next.js 16 (React 19, client components), TypeScript, Radix Tabs, Vitest (pure-logic tests only — UI is browser-verified), pnpm workspaces.

---

## File structure

**Create:**
- `apps/web/src/lib/lightbox-tab.ts` — `LightboxTab` string enum (Info/Edit/Exif), the single source of truth for tab values.
- `apps/web/src/lib/grid-shortcut.ts` — pure `resolveGridShortcut(input)` → action descriptor.
- `apps/web/src/lib/grid-shortcut.test.ts` — Vitest cases for the pure function.
- `apps/web/src/components/photo-grid/grid-shortcuts.tsx` — the `GridShortcuts` client component (DOM wiring).

**Modify:**
- `apps/web/src/components/photo-grid/photo-collection.tsx` — `open(index, opts?: { tab })`, `openTab` state, expose `openTab`.
- `apps/web/src/components/photo-grid/lightbox.tsx` — read `openTab`, pass to the sidebar.
- `apps/web/src/components/photo-grid/lightbox-sidebar.tsx` — accept `initialTab`, use as `<Tabs defaultValue>`, switch inline tab values to `LightboxTab`.
- `apps/web/src/app/(app)/photos/library-view.tsx` — render `<GridShortcuts />`.
- `apps/web/src/app/(app)/favorites/favorites-view.tsx` — render `<GridShortcuts />`.
- `apps/web/src/app/(app)/albums/[id]/album-view.tsx` — render `<GridShortcuts />`.
- `apps/web/src/app/(app)/search/search-view.tsx` — render `<GridShortcuts />`.
- `apps/web/src/app/(app)/albums/folder/[id]/photos/folder-photos-view.tsx` — render `<GridShortcuts />`.

**Commands (pnpm workspace, package `@lumio/web`):**
- Run one test file: `pnpm --filter @lumio/web test src/lib/grid-shortcut.test.ts`
- Run all web tests: `pnpm --filter @lumio/web test`
- Lint: `pnpm --filter @lumio/web lint`

Note: there is no `typecheck` gate — `tsc` reports pre-existing shared-DB drift noise in this repo, so the gates are **lint + tests + browser verification**.

---

## Task 1: `LightboxTab` enum + pure `resolveGridShortcut` (TDD)

**Files:**
- Create: `apps/web/src/lib/lightbox-tab.ts`
- Create: `apps/web/src/lib/grid-shortcut.ts`
- Test: `apps/web/src/lib/grid-shortcut.test.ts`

- [ ] **Step 1: Create the `LightboxTab` enum**

`apps/web/src/lib/lightbox-tab.ts`:

```ts
/** The lightbox sidebar's tabs. String values match the Radix tab `value`s. */
export enum LightboxTab {
  Info = "info",
  Edit = "edit",
  Exif = "exif",
}
```

- [ ] **Step 2: Write the failing test**

`apps/web/src/lib/grid-shortcut.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { resolveGridShortcut, type GridShortcutInput } from "./grid-shortcut";
import { LightboxTab } from "./lightbox-tab";

/** A neutral, unguarded context with a single selected photo. */
function base(overrides: Partial<GridShortcutInput> = {}): GridShortcutInput {
  return {
    key: "f",
    hasModifier: false,
    repeat: false,
    selectionSize: 1,
    lightboxOpen: false,
    inEditable: false,
    overlayOpen: false,
    ...overrides,
  };
}

describe("resolveGridShortcut", () => {
  it("f favourites any non-empty selection", () => {
    expect(resolveGridShortcut(base({ key: "f", selectionSize: 1 }))).toEqual({ kind: "favorite" });
    expect(resolveGridShortcut(base({ key: "f", selectionSize: 5 }))).toEqual({ kind: "favorite" });
  });

  it("f does nothing with an empty selection", () => {
    expect(resolveGridShortcut(base({ key: "f", selectionSize: 0 }))).toBeNull();
  });

  it("f is case-insensitive (Caps Lock) but ignores Shift+F", () => {
    expect(resolveGridShortcut(base({ key: "F", hasModifier: false }))).toEqual({ kind: "favorite" });
    expect(resolveGridShortcut(base({ key: "F", hasModifier: true }))).toBeNull();
  });

  it("Enter opens the Info tab only when exactly one is selected", () => {
    expect(resolveGridShortcut(base({ key: "Enter", selectionSize: 1 }))).toEqual({
      kind: "open",
      tab: LightboxTab.Info,
    });
    expect(resolveGridShortcut(base({ key: "Enter", selectionSize: 0 }))).toBeNull();
    expect(resolveGridShortcut(base({ key: "Enter", selectionSize: 2 }))).toBeNull();
  });

  it("e opens the Edit tab only when exactly one is selected", () => {
    expect(resolveGridShortcut(base({ key: "e", selectionSize: 1 }))).toEqual({
      kind: "open",
      tab: LightboxTab.Edit,
    });
    expect(resolveGridShortcut(base({ key: "e", selectionSize: 3 }))).toBeNull();
  });

  it("is suppressed by every guard", () => {
    expect(resolveGridShortcut(base({ lightboxOpen: true }))).toBeNull();
    expect(resolveGridShortcut(base({ hasModifier: true }))).toBeNull();
    expect(resolveGridShortcut(base({ repeat: true }))).toBeNull();
    expect(resolveGridShortcut(base({ inEditable: true }))).toBeNull();
    expect(resolveGridShortcut(base({ overlayOpen: true }))).toBeNull();
  });

  it("ignores unrelated keys", () => {
    expect(resolveGridShortcut(base({ key: "x" }))).toBeNull();
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm --filter @lumio/web test src/lib/grid-shortcut.test.ts`
Expected: FAIL — `resolveGridShortcut` is not exported / module not found.

- [ ] **Step 4: Implement the pure function**

`apps/web/src/lib/grid-shortcut.ts`:

```ts
import { LightboxTab } from "./lightbox-tab";

/** What a grid keypress resolves to. `null` means "do nothing". */
export type GridShortcutAction =
  | { kind: "favorite" }
  | { kind: "open"; tab: LightboxTab }
  | null;

export interface GridShortcutInput {
  /** `KeyboardEvent.key`. */
  key: string;
  /** Any of meta/ctrl/alt/shift held. */
  hasModifier: boolean;
  /** `KeyboardEvent.repeat` (auto-repeat from a held key). */
  repeat: boolean;
  /** Number of currently selected photos. */
  selectionSize: number;
  /** The lightbox is open (it owns the keyboard then). */
  lightboxOpen: boolean;
  /** Focus is in an input/textarea/contentEditable. */
  inEditable: boolean;
  /** A Radix dialog/alertdialog/menu is open. */
  overlayOpen: boolean;
}

/**
 * Decide what a grid keypress should do. Pure: all DOM/context facts are passed
 * in, so it is fully unit-testable. The thin `GridShortcuts` component supplies
 * these facts and dispatches the returned action.
 */
export function resolveGridShortcut(i: GridShortcutInput): GridShortcutAction {
  if (i.lightboxOpen || i.hasModifier || i.repeat || i.inEditable || i.overlayOpen) {
    return null;
  }
  switch (i.key.toLowerCase()) {
    case "f":
      return i.selectionSize >= 1 ? { kind: "favorite" } : null;
    case "enter":
      return i.selectionSize === 1 ? { kind: "open", tab: LightboxTab.Info } : null;
    case "e":
      return i.selectionSize === 1 ? { kind: "open", tab: LightboxTab.Edit } : null;
    default:
      return null;
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @lumio/web test src/lib/grid-shortcut.test.ts`
Expected: PASS (all cases green).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/lightbox-tab.ts apps/web/src/lib/grid-shortcut.ts apps/web/src/lib/grid-shortcut.test.ts
git commit -m "feat(web): pure grid keyboard-shortcut resolver + LightboxTab enum"
```

---

## Task 2: Thread a chosen tab through the lightbox open path

This lets `e` open the lightbox directly on the Edit tab. Backward-compatible: the
new `opts` arg is optional, so every existing `open(index)` caller stays on Info.

**Files:**
- Modify: `apps/web/src/components/photo-grid/photo-collection.tsx`
- Modify: `apps/web/src/components/photo-grid/lightbox.tsx`
- Modify: `apps/web/src/components/photo-grid/lightbox-sidebar.tsx`

- [ ] **Step 1: Extend the collection's `open` to carry a tab**

In `apps/web/src/components/photo-grid/photo-collection.tsx`:

(a) Add the import near the other imports (after line 16, `import { displayUrl } ...`):

```ts
import { LightboxTab } from "@/lib/lightbox-tab";
```

(b) In the `PhotoCollectionValue` interface (the `// Lightbox` block, lines 35–41), change the `open` signature and add `openTab`:

```ts
  // Lightbox
  enableLightbox: boolean;
  openIndex: number | null;
  /** The tab the lightbox should show on this open (defaults to Info). */
  openTab: LightboxTab;
  open: (index: number, opts?: { tab?: LightboxTab }) => void;
  close: () => void;
  step: (delta: 1 | -1) => void;
  urlForId: (id: string) => string;
```

(c) Add `openTab` state next to `openIndex` (after line 90, `const [openIndex, setOpenIndex] = useState...`):

```ts
  const [openTab, setOpenTab] = useState<LightboxTab>(LightboxTab.Info);
```

(d) Update the `open` callback (lines 159–179) to set the tab. Replace its body's
final lines so it reads:

```ts
  const open = useCallback(
    (index: number, opts?: { tab?: LightboxTab }) => {
      if (!enableLightbox) return;
      // First open of this session pushes ONE history entry; navigating within the
      // already-open lightbox (film-strip jumps, arrows) only replaces — the
      // URL-sync effect handles that, so `pushed` always means "one back() returns
      // to the grid" and close() stays correct. The pushState runs HERE in the
      // event handler, reading the current openIndex — NOT inside a setState
      // updater (React may invoke updaters during render, and a side effect there
      // throws "cannot update Router while rendering").
      if (openIndex === null && typeof window !== "undefined") {
        const p = photoForIndex(index);
        if (p) {
          window.history.pushState(null, "", url(p.id));
          pushed.current = true;
        }
      }
      // Always reset to Info unless a tab is requested, so double-click /
      // film-strip / deep-link opens never inherit a stale Edit tab.
      setOpenTab(opts?.tab ?? LightboxTab.Info);
      setOpenIndex(index);
    },
    [enableLightbox, openIndex, photoForIndex, url],
  );
```

(e) Add `openTab` to the `value` memo object (after `openIndex,` in the object at
lines 240–257) and to its dependency array (after `openIndex,` at lines 258–275):

In the object literal:
```ts
      openIndex,
      openTab,
      open,
```
In the deps array:
```ts
      openIndex,
      openTab,
      open,
```

- [ ] **Step 2: Pass the tab from the lightbox into the sidebar**

In `apps/web/src/components/photo-grid/lightbox.tsx`, in `LightboxOverlay`
(line 63), add `openTab` to the destructure and pass it to the sidebar.

Change line 63 from:
```ts
  const { openIndex, total, step, close, open } = usePhotoCollection();
```
to:
```ts
  const { openIndex, total, step, close, open, openTab } = usePhotoCollection();
```

Change the sidebar render (line 120) from:
```tsx
        <LightboxSidebar photo={photo} />
```
to:
```tsx
        <LightboxSidebar photo={photo} initialTab={openTab} />
```

- [ ] **Step 3: Make the sidebar honour `initialTab`**

In `apps/web/src/components/photo-grid/lightbox-sidebar.tsx`:

(a) Add the import (after line 13, `import { LightboxEditPanel } ...`):

```ts
import { LightboxTab } from "@/lib/lightbox-tab";
```

(b) Change the component signature (line 15) to accept the prop:

```tsx
export function LightboxSidebar({
  photo,
  initialTab = LightboxTab.Info,
}: {
  photo: PhotoDTO;
  initialTab?: LightboxTab;
}) {
```

(c) Use it as the tabs' default and switch the inline tab values to the enum.
Replace the `<Tabs ...>` open tag (line 41) and the trigger/content `value`s so
they use `LightboxTab`:

```tsx
      <Tabs defaultValue={initialTab} className="gap-0 lg:min-h-0 lg:flex-1">
        <div className="flex shrink-0 items-center border-b px-3 py-2">
          <TabsList className="w-full">
            <TabsTrigger value={LightboxTab.Info}>Info</TabsTrigger>
            <TabsTrigger value={LightboxTab.Edit}>Edit</TabsTrigger>
            <TabsTrigger value={LightboxTab.Exif}>EXIF</TabsTrigger>
          </TabsList>
        </div>
```

And the three `TabsContent` `value`s (lines 51, 76, 80):

```tsx
          <TabsContent value={LightboxTab.Info} className="space-y-4">
```
```tsx
          <TabsContent value={LightboxTab.Edit} className="lg:flex lg:flex-col">
```
```tsx
          <TabsContent value={LightboxTab.Exif}>
```

(Leave the bodies of each `TabsContent` unchanged.)

- [ ] **Step 4: Verify the existing suite + lint still pass**

Run: `pnpm --filter @lumio/web test`
Expected: PASS (no behavioural change to existing tests).

Run: `pnpm --filter @lumio/web lint`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/photo-grid/photo-collection.tsx apps/web/src/components/photo-grid/lightbox.tsx apps/web/src/components/photo-grid/lightbox-sidebar.tsx
git commit -m "feat(web): open the lightbox on a chosen sidebar tab"
```

---

## Task 3: The `GridShortcuts` component

**Files:**
- Create: `apps/web/src/components/photo-grid/grid-shortcuts.tsx`

- [ ] **Step 1: Create the component**

`apps/web/src/components/photo-grid/grid-shortcuts.tsx`:

```tsx
"use client";

import { useEffect, useRef } from "react";
import { computeFavoriteTarget } from "@lumio/shared";
import { resolveGridShortcut } from "@/lib/grid-shortcut";
import { usePhotoActionsContext } from "@/components/photo-actions/photo-actions-context";
import { usePhotoCollection } from "./photo-collection";

/**
 * Document-level keyboard shortcuts for a photo grid:
 *   f      — toggle favourite over the whole selection (smart target)
 *   Enter  — open the single selected photo on the Info tab
 *   e      — open the single selected photo on the Edit tab
 *
 * Inert while the lightbox is open, while typing in a field, while a dialog/menu
 * is open, or while a modifier is held. Mirrors `useLightboxKeyboard`: the
 * listener registers once and reads the latest props through a single ref so it
 * never re-binds. The decision is delegated to the pure `resolveGridShortcut`.
 */
export function GridShortcuts({ selectedIds }: { selectedIds: Set<string> }) {
  const { open, openIndex, getLoadedIds, getPhotos } = usePhotoCollection();
  const actions = usePhotoActionsContext();

  const ref = useRef({ selectedIds, open, openIndex, getLoadedIds, getPhotos, actions });
  useEffect(() => {
    ref.current = { selectedIds, open, openIndex, getLoadedIds, getPhotos, actions };
  });

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const c = ref.current;
      const el = document.activeElement;
      const inEditable =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLElement && el.isContentEditable);
      const overlayOpen =
        document.querySelector(
          '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"]',
        ) !== null;

      const action = resolveGridShortcut({
        key: e.key,
        hasModifier: e.metaKey || e.ctrlKey || e.altKey || e.shiftKey,
        repeat: e.repeat,
        selectionSize: c.selectedIds.size,
        lightboxOpen: c.openIndex !== null,
        inEditable,
        overlayOpen,
      });
      if (!action) return;

      // Enter on a focused tile `<a>` would otherwise fire its click (toggling
      // selection); prevent the default activation since we handle it here.
      if (e.key === "Enter") e.preventDefault();

      if (action.kind === "favorite") {
        if (!c.actions) return;
        const ids = [...c.selectedIds];
        const target = computeFavoriteTarget(c.getPhotos(c.selectedIds));
        void c.actions.favorite(ids, target);
        return;
      }

      // action.kind === "open" — selectionSize is guaranteed 1 by the resolver.
      const [id] = c.selectedIds;
      if (!id) return;
      const index = c.getLoadedIds().indexOf(id);
      if (index === -1) return; // selected ids are always loaded; guard defensively
      c.open(index, { tab: action.tab });
    };

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return null;
}
```

- [ ] **Step 2: Lint the new file**

Run: `pnpm --filter @lumio/web lint`
Expected: no errors (note: `"use client"` is line 1; the ref is read/written only
inside effects, matching `use-lightbox-keyboard.ts`).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/photo-grid/grid-shortcuts.tsx
git commit -m "feat(web): GridShortcuts component (f / Enter / e on the grid)"
```

---

## Task 4: Wire `GridShortcuts` into the five grid views

Each view already has the identical shape: `<PhotoActionsProvider value={actions}>`
wrapping `<PhotoGrid ... selectedIds={sel.selected} .../>` then `<Lightbox />`. Add
the import and render `<GridShortcuts selectedIds={sel.selected} />` immediately
after `<Lightbox />` (inside `PhotoActionsProvider`, so it can read both contexts).

**Files:**
- Modify: `apps/web/src/app/(app)/photos/library-view.tsx`
- Modify: `apps/web/src/app/(app)/favorites/favorites-view.tsx`
- Modify: `apps/web/src/app/(app)/albums/[id]/album-view.tsx`
- Modify: `apps/web/src/app/(app)/search/search-view.tsx`
- Modify: `apps/web/src/app/(app)/albums/folder/[id]/photos/folder-photos-view.tsx`

- [ ] **Step 1: Library view**

In `apps/web/src/app/(app)/photos/library-view.tsx`, add the import next to the
other `photo-grid` imports (e.g. after line 17, `import { Lightbox } ...`):

```ts
import { GridShortcuts } from "@/components/photo-grid/grid-shortcuts";
```

Then change (lines 130–131):
```tsx
          <Lightbox />
        </PhotoActionsProvider>
```
to:
```tsx
          <Lightbox />
          <GridShortcuts selectedIds={sel.selected} />
        </PhotoActionsProvider>
```

- [ ] **Step 2: Favorites view**

In `apps/web/src/app/(app)/favorites/favorites-view.tsx`, add the import after
line 24 (`import { Lightbox } ...`):

```ts
import { GridShortcuts } from "@/components/photo-grid/grid-shortcuts";
```

Then change (lines 145–146):
```tsx
          <Lightbox />
        </PhotoActionsProvider>
```
to:
```tsx
          <Lightbox />
          <GridShortcuts selectedIds={sel.selected} />
        </PhotoActionsProvider>
```

- [ ] **Step 3: Album view**

In `apps/web/src/app/(app)/albums/[id]/album-view.tsx`, add the import after
line 18 (`import { Lightbox } ...`):

```ts
import { GridShortcuts } from "@/components/photo-grid/grid-shortcuts";
```

Then change (lines 242–243):
```tsx
          <Lightbox />
        </PhotoActionsProvider>
```
to:
```tsx
          <Lightbox />
          <GridShortcuts selectedIds={sel.selected} />
        </PhotoActionsProvider>
```

- [ ] **Step 4: Search view**

In `apps/web/src/app/(app)/search/search-view.tsx`, add the import after line 23
(`import { Lightbox } ...`):

```ts
import { GridShortcuts } from "@/components/photo-grid/grid-shortcuts";
```

Then change (lines 231–232):
```tsx
                  <Lightbox />
                </PhotoActionsProvider>
```
to:
```tsx
                  <Lightbox />
                  <GridShortcuts selectedIds={sel.selected} />
                </PhotoActionsProvider>
```

- [ ] **Step 5: Folder photos view**

In `apps/web/src/app/(app)/albums/folder/[id]/photos/folder-photos-view.tsx`, add
the import after line 18 (`import { Lightbox } ...`):

```ts
import { GridShortcuts } from "@/components/photo-grid/grid-shortcuts";
```

Then change (lines 137–138):
```tsx
          <Lightbox />
        </PhotoActionsProvider>
```
to:
```tsx
          <Lightbox />
          <GridShortcuts selectedIds={sel.selected} />
        </PhotoActionsProvider>
```

- [ ] **Step 6: Lint + tests**

Run: `pnpm --filter @lumio/web lint`
Expected: no errors.

Run: `pnpm --filter @lumio/web test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add "apps/web/src/app/(app)/photos/library-view.tsx" "apps/web/src/app/(app)/favorites/favorites-view.tsx" "apps/web/src/app/(app)/albums/[id]/album-view.tsx" "apps/web/src/app/(app)/search/search-view.tsx" "apps/web/src/app/(app)/albums/folder/[id]/photos/folder-photos-view.tsx"
git commit -m "feat(web): enable grid keyboard shortcuts on all five grid views"
```

---

## Task 5: Browser verification

No automated DOM tests exist in this repo (UI is browser-verified). Run the app
and confirm behaviour.

**Files:** none (verification only).

- [ ] **Step 1: Start the dev server**

Run: `pnpm --filter @lumio/web dev` (or `pnpm dev` from the repo root).
Open the app and sign in; navigate to `/photos`.

- [ ] **Step 2: Verify `Enter` / `e` (single selection) on `/photos`**

- Click one photo to select it (one selection ring). Press **Enter** → the
  lightbox opens on the **Info** tab. Press **Escape** to close.
- With the same single selection, press **e** → the lightbox opens on the
  **Edit** tab. Close.
- Click empty space (clear selection). Press **Enter**, then **e** → nothing
  happens. Select two photos (shift-click). Press **Enter**/**e** → nothing.

- [ ] **Step 3: Verify `f` (multi selection) on `/photos`**

- Select several photos (mix of favourited and not). Press **f** → all become
  favourited (hearts fill). Press **f** again → all unfavourite (smart toggle).
- Select a single photo, press **f** → it toggles.

- [ ] **Step 4: Verify the guards**

- Focus the Search box and type letters incl. `e`/`f` → no shortcut fires.
- Open a dialog (e.g. select photos → trash → the confirm dialog) → `e`/`f`/Enter
  don't trigger grid actions while it's open.
- Open the lightbox, press `f` → only the lightbox's own favourite toggles (the
  grid handler is suppressed); arrows still navigate.

- [ ] **Step 5: Spot-check the other four views**

Repeat Steps 2–3 briefly on **Favorites**, an **Album**, a **Search** results
page, and a **Folder photos** page. On **Favorites**, confirm `f`-unfavouriting a
selected tile removes it from the grid (matches the toolbar button there).

- [ ] **Step 6: Final commit (if any verification fixups were needed)**

```bash
git add -A
git commit -m "fix(web): grid keyboard shortcuts verification fixups"
```

(Skip if no changes were required.)
