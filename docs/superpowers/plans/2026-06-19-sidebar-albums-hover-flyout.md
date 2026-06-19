# Sidebar Albums Hover Flyout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hovering the sidebar **Albums** item opens a flyout to the right listing albums (cover thumbnail + name + photo count) that link to each album; clicking the Albums label still navigates to `/albums`.

**Architecture:** Add the shadcn `HoverCard` (Radix) primitive. Extract the existing `NavLink` into a shared module so a new `SidebarAlbums` client component can reuse it as the hover trigger. `SidebarAlbums` fetches `GET /api/albums`, controls the HoverCard's open state (never opening when there are zero albums), and renders the album list in `HoverCardContent`. `app-sidebar` renders `SidebarAlbums` in place of the plain Albums `NavLink`.

**Tech Stack:** Next.js 15 (App Router, RSC) + React 19, `radix-ui` unified package (v1.6.0, already a dependency — bundles `HoverCard`), Tailwind v4, shadcn `ui/` wrappers, `@lumio/shared` DTOs, pnpm workspaces.

---

## File structure

- **Create** `apps/web/src/components/ui/hover-card.tsx` — shadcn HoverCard primitive (`HoverCard`, `HoverCardTrigger`, `HoverCardContent`), styled to match the existing `ui/dropdown-menu.tsx` popover.
- **Create** `apps/web/src/components/sidebar-nav-link.tsx` — the shared `NavItem` type, `isActive()`, and `NavLink` component (moved out of `app-sidebar.tsx`), with `NavLink` forwarding extra props/ref so it works as a Radix `asChild` trigger.
- **Create** `apps/web/src/components/sidebar-albums.tsx` — `SidebarAlbums` client component: HoverCard wrapping the Albums `NavLink`, album fetch, empty-guard open control, and the row list.
- **Modify** `apps/web/src/components/app-sidebar.tsx` — import `NavLink`/`isActive`/`NavItem` from the new module; render `<SidebarAlbums>` for the `/albums` entry.

**No tests:** this is a presentational/wiring change reusing an existing endpoint, with no new pure logic to isolate (same call the prior `sidebar-more` spec made). Verification is `lint` + browser-verify per task.

**Verification commands used throughout:**
- Lint: `pnpm --filter @lumio/web lint`
- Run app for browser-verify: `pnpm dev` (serves the web app; open http://localhost:3000)

---

## Task 1: Add the HoverCard UI primitive

**Files:**
- Create: `apps/web/src/components/ui/hover-card.tsx`

- [ ] **Step 1: Create the HoverCard primitive**

Mirrors the import style and popover styling of `apps/web/src/components/ui/dropdown-menu.tsx` (unified `radix-ui` package, `data-slot` attributes, `cn`). The content uses a fixed `w-64`, the hover-card transform-origin var, and the same animation classes as the dropdown content.

```tsx
"use client";

import * as React from "react";
import { HoverCard as HoverCardPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

function HoverCard({
  ...props
}: React.ComponentProps<typeof HoverCardPrimitive.Root>) {
  return <HoverCardPrimitive.Root data-slot="hover-card" {...props} />;
}

function HoverCardTrigger({
  ...props
}: React.ComponentProps<typeof HoverCardPrimitive.Trigger>) {
  return (
    <HoverCardPrimitive.Trigger data-slot="hover-card-trigger" {...props} />
  );
}

function HoverCardContent({
  className,
  align = "center",
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof HoverCardPrimitive.Content>) {
  return (
    <HoverCardPrimitive.Portal>
      <HoverCardPrimitive.Content
        data-slot="hover-card-content"
        align={align}
        sideOffset={sideOffset}
        className={cn(
          "z-50 w-64 origin-(--radix-hover-card-content-transform-origin) rounded-2xl bg-popover p-1 text-popover-foreground shadow-2xl ring-1 ring-foreground/5 duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 dark:ring-foreground/10 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
          className,
        )}
        {...props}
      />
    </HoverCardPrimitive.Portal>
  );
}

export { HoverCard, HoverCardTrigger, HoverCardContent };
```

- [ ] **Step 2: Lint the new file**

Run: `pnpm --filter @lumio/web lint`
Expected: PASS (no errors for `hover-card.tsx`). `radix-ui` already exposes `HoverCard` (it bundles `@radix-ui/react-hover-card`), so no install is needed.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/ui/hover-card.tsx
git commit -m "feat(web): add shadcn HoverCard primitive"
```

---

## Task 2: Extract NavLink into a shared module (pure refactor)

Moves `NavItem`, `isActive`, and `NavLink` out of `app-sidebar.tsx` unchanged in behavior, but makes `NavLink` forward extra props and `ref` so it can be a Radix `asChild` trigger in Task 3.

**Files:**
- Create: `apps/web/src/components/sidebar-nav-link.tsx`
- Modify: `apps/web/src/components/app-sidebar.tsx`

- [ ] **Step 1: Create the shared nav-link module**

```tsx
"use client";

import Link from "next/link";
import { Images } from "lucide-react";
import { cn } from "@/lib/utils";

export type NavItem = {
  href: string;
  label: string;
  icon: typeof Images;
  /** match when the pathname starts with one of these segments */
  match: string[];
};

export function isActive(pathname: string, item: NavItem) {
  return item.match.some((m) => pathname === m || pathname.startsWith(`${m}/`));
}

type NavLinkProps = Omit<React.ComponentProps<typeof Link>, "href"> & {
  item: NavItem;
  active: boolean;
};

// `...props` + spread onto <Link> lets this be used as a Radix `asChild`
// trigger: Slot injects hover/focus handlers and a ref, which flow through to
// the underlying anchor.
export function NavLink({ item, active, ...props }: NavLinkProps) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      aria-current={active ? "page" : undefined}
      title={item.label}
      className={cn(
        "group flex w-14 flex-col items-center gap-1 rounded-2xl py-2.5 transition-colors",
        active
          ? "text-foreground"
          : "text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
      {...props}
    >
      <Icon
        className="h-[26px] w-[26px] transition-transform duration-200 group-active:scale-90"
        strokeWidth={active ? 2.4 : 1.8}
        aria-hidden
      />
      <span
        className={cn(
          "text-[10px] leading-none tracking-wide",
          active ? "font-semibold" : "font-medium",
        )}
      >
        {item.label}
      </span>
    </Link>
  );
}
```

- [ ] **Step 2: Update `app-sidebar.tsx` to import from the shared module**

Remove the local `NavItem` type, `isActive`, and `NavLink` definitions, and import them instead. Replace the import block at the top:

Change lines 1-8 (the imports) — remove the now-unused `GalleryVerticalEnd`/`cn`/`Link` only if they become unused. `Link` is still used for the brand logo, and `GalleryVerticalEnd` is still used in `PRIMARY`. So only add the new import. The top of the file becomes:

```tsx
"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ArrowLeft, Images, GalleryVerticalEnd, ImageUp } from "lucide-react";
import { Logo } from "@/components/logo";
import { SidebarMore } from "@/components/sidebar-more";
import { NavLink, isActive, type NavItem } from "@/components/sidebar-nav-link";
```

(Note: `cn` is no longer used in this file once `NavLink` moves out — drop the `import { cn } from "@/lib/utils";` line. Keep `Link` — it's used by the brand logo.)

Then delete the local `type NavItem = {...}` block (old lines 10-16), the `isActive` function (old lines 24-28), and the entire `NavLink` function (old lines 30-59). Keep the `PRIMARY` array as-is.

- [ ] **Step 3: Lint to confirm no unused imports / no broken references**

Run: `pnpm --filter @lumio/web lint`
Expected: PASS. If lint flags `cn` as unused, remove its import (per Step 2). If it flags `Link` as unused, that means the brand logo block was changed accidentally — revert that.

- [ ] **Step 4: Browser-verify the refactor is behavior-neutral**

Run: `pnpm dev`, open http://localhost:3000/photos
Expected: sidebar renders identically — Photos / Albums / Upload icons + labels, correct active highlight on the current route, hover background on inactive items. Clicking Albums still navigates to `/albums`. (No flyout yet.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/sidebar-nav-link.tsx apps/web/src/components/app-sidebar.tsx
git commit -m "refactor(web): extract NavLink into shared sidebar module"
```

---

## Task 3: Build the SidebarAlbums flyout component

**Files:**
- Create: `apps/web/src/components/sidebar-albums.tsx`

- [ ] **Step 1: Create the component**

Fetches albums on mount and re-fetches on open; controls `open` so it never opens with zero albums; renders thumbnail + name + count rows linking to each album. Row markup mirrors `apps/web/src/app/(app)/albums/page.tsx` (thumbnail with `/api/thumbnails/{coverPhotoId}`, `Images` placeholder, singular/plural count). Fetch shape mirrors `add-to-album-dialog.tsx`.

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Images } from "lucide-react";
import type { AlbumSummaryDTO } from "@lumio/shared";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { NavLink, type NavItem } from "@/components/sidebar-nav-link";

export function SidebarAlbums({
  item,
  active,
}: {
  item: NavItem;
  active: boolean;
}) {
  const [albums, setAlbums] = useState<AlbumSummaryDTO[]>([]);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    fetch("/api/albums")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error())))
      .then((data: { items: AlbumSummaryDTO[] }) => setAlbums(data.items))
      .catch(() => {
        // Leave the list empty; the flyout simply won't open.
      });
  }, []);

  // Load once on mount so the first hover can open immediately.
  useEffect(() => {
    load();
  }, [load]);

  return (
    <HoverCard
      open={open}
      onOpenChange={(next) => {
        // Refresh on each open so a newly-created album shows up...
        if (next) load();
        // ...and never open when there are no albums (empty guard).
        setOpen(next && albums.length > 0);
      }}
      openDelay={120}
      closeDelay={100}
    >
      <HoverCardTrigger asChild>
        <NavLink item={item} active={active} />
      </HoverCardTrigger>
      <HoverCardContent
        side="right"
        align="start"
        sideOffset={8}
        className="max-h-[360px] overflow-y-auto"
      >
        <ul>
          {albums.map((album) => (
            <li key={album.id}>
              <Link
                href={`/albums/${album.id}`}
                className="flex items-center gap-3 rounded-xl p-2 transition-colors hover:bg-muted"
              >
                <div className="flex aspect-[4/3] w-11 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-muted">
                  {album.coverPhotoId ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/thumbnails/${album.coverPhotoId}`}
                      alt={album.name}
                      loading="lazy"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <Images className="size-4 text-muted-foreground" />
                  )}
                </div>
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{album.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {album.photoCount}{" "}
                    {album.photoCount === 1 ? "photo" : "photos"}
                  </p>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </HoverCardContent>
    </HoverCard>
  );
}
```

- [ ] **Step 2: Lint the new file**

Run: `pnpm --filter @lumio/web lint`
Expected: PASS. The component is not yet rendered anywhere, so this only checks it compiles/lints cleanly (types resolve: `AlbumSummaryDTO`, `NavItem`, HoverCard exports).

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/sidebar-albums.tsx
git commit -m "feat(web): add SidebarAlbums hover flyout component"
```

---

## Task 4: Wire SidebarAlbums into the sidebar

**Files:**
- Modify: `apps/web/src/components/app-sidebar.tsx`

- [ ] **Step 1: Import SidebarAlbums**

Add to the import block in `app-sidebar.tsx`:

```tsx
import { SidebarAlbums } from "@/components/sidebar-albums";
```

- [ ] **Step 2: Render SidebarAlbums for the `/albums` entry**

Replace the primary-nav `.map` (the block that renders `{PRIMARY.map((item) => (<NavLink ... />))}` inside `<nav ...>`):

```tsx
      {/* Primary nav — vertically centered in the rail */}
      <nav className="flex flex-1 flex-col items-center justify-center gap-1">
        {PRIMARY.map((item) =>
          item.href === "/albums" ? (
            <SidebarAlbums
              key={item.href}
              item={item}
              active={isActive(pathname, item)}
            />
          ) : (
            <NavLink
              key={item.href}
              item={item}
              active={isActive(pathname, item)}
            />
          ),
        )}
      </nav>
```

- [ ] **Step 3: Lint**

Run: `pnpm --filter @lumio/web lint`
Expected: PASS.

- [ ] **Step 4: Browser-verify end to end**

Run: `pnpm dev`, open http://localhost:3000/photos

Verify each:
- **Hover Albums** → after ~120ms a flyout appears to the right of the rail, listing albums with a cover thumbnail (or the placeholder icon for albums without a cover), the album name, and `N photos` / `1 photo`.
- **Click a row** → navigates to that `/albums/{id}`.
- **Click the Albums label** (not a row) → still navigates to `/albums`.
- **Move the mouse away** → flyout closes (~100ms).
- **Many albums** → the panel caps height and scrolls.
- **New album:** create an album (e.g. via the Albums page "New album"), return and hover Albums again → the new album appears (re-fetch on open).
- **Empty case:** with zero albums in the DB, hovering Albums shows no flyout (the label still navigates to `/albums`). If your dev DB always has albums, sanity-check the guard by confirming the flyout never appears before albums have loaded.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/app-sidebar.tsx
git commit -m "feat(web): show album list on Albums hover in sidebar"
```

---

## Self-review notes (addressed)

- **Spec coverage:** hover-opens / click-still-navigates (Tasks 2-4), thumbnail+name+count rows (Task 3), list-only with no extra chrome (Task 3 renders only the `<ul>`), no-albums-never-opens empty guard (Task 3 `onOpenChange`), HoverCard primitive + shared NavLink + SidebarAlbums + reuse of `GET /api/albums` (Tasks 1-4), re-fetch-on-open freshness (Task 3) — all present.
- **`asChild` ref/handlers:** `NavLink` spreads `...props` (including the ref React 19 forwards) onto `<Link>`, so Radix `Slot` can inject hover/focus handlers — required for the trigger to actually fire (Task 2).
- **No new dependency:** `radix-ui@1.6.0` already bundles `HoverCard`; Task 1 only adds the wrapper file.
- **Naming consistency:** `SidebarAlbums({ item, active })`, `NavLink({ item, active, ...props })`, `isActive(pathname, item)`, and `{ items: AlbumSummaryDTO[] }` response shape are used identically across tasks.
