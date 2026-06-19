# Sidebar "More" Menu — Design

**Date:** 2026-06-18
**Status:** Approved (pending spec review)

## Goal

Replace the two standalone bottom items in the sidebar rail — the **Settings** nav link and the
**Logout** button — with a single **"More"** rail item that opens a shadcn dropdown menu. The menu
contains **Settings**, a **Theme** submenu (**System** / **Light** / **Dark**), and **Log out**.

Today the app has dark-mode CSS tokens (`globals.css` defines `:root` + `.dark`, and the Tailwind v4
`@custom-variant dark`) but **nothing toggles the `.dark` class** — no `next-themes`, no provider,
`<html>` never gets a `dark` class. So this change also wires up real theme switching for the first
time.

## Non-goals (YAGNI)

- A full settings page for appearance — the theme control lives only in this menu.
- Per-route theme overrides, scheduled/auto themes, or extra color schemes beyond the standard
  System / Light / Dark.
- Changing any other sidebar item (Photos / Albums / Upload / brand-back-button) or the rail layout.

## UX

### The "More" rail item
The trigger looks exactly like the existing `NavLink` items: a centered icon over a small label, same
sizing (`w-14`, `py-2.5`, `rounded-2xl`), same color/hover treatment. Icon: **`MoreHorizontal`**
(horizontal ellipsis ⋯), label **"More"**. It sits in the existing bottom group where Settings +
Logout were.

**Active state:** the trigger shows the active (foreground) treatment when the current route is
`/settings` (preserving the old Settings-active affordance) **or** while the menu is open. Otherwise
it uses the muted/hover treatment like an inactive `NavLink`.

### The menu
Opens with `side="right"` and `align="end"` so it appears to the right of the narrow rail, anchored to
the bottom near the trigger. Contents, top to bottom:

1. **Settings** — gear icon, navigates to `/settings` (via `next/link` on the menu item, or
   `router.push`). Closes the menu.
2. **Theme** — a `DropdownMenuSub`. The submenu trigger shows a theme icon and "Theme"; the submenu
   content is a `DropdownMenuRadioGroup` bound to `next-themes` with three items:
   - **System** — `Monitor` icon
   - **Light** — `Sun` icon
   - **Dark** — `Moon` icon

   The radio group's `value` is the current `theme` (`"system" | "light" | "dark"`); selecting an item
   calls `setTheme(value)`. The active item shows the standard radio indicator.
3. separator
4. **Log out** — logout icon, **destructive** styling (`text-destructive` / `variant`), runs the
   existing `signOut()` then `router.replace("/login")`. Closes the menu.

## Architecture

### Theme infrastructure (`next-themes`)
- Add the `next-themes` dependency to `apps/web`.
- **New** `apps/web/src/components/theme-provider.tsx` — a `"use client"` wrapper around
  `next-themes`' `ThemeProvider`, passing through children/props.
- **`apps/web/src/app/layout.tsx`** (root) — wrap `{children}` in `<ThemeProvider attribute="class"
  defaultTheme="system" enableSystem disableTransitionOnChange>` and add `suppressHydrationWarning` to
  the `<html>` element (required by next-themes' pre-hydration inline script to avoid a
  flash-of-wrong-theme and a hydration warning). This is the app-wide layout, so theming covers the
  whole app, not just the `(app)` group.

### Menu component
- **New** `apps/web/src/components/ui/dropdown-menu.tsx` — the standard shadcn `dropdown-menu`
  primitive set (added via the shadcn CLI/registry, matching the other `ui/` components). Includes
  `DropdownMenu`, `Trigger`, `Content`, `Item`, `Separator`, `Label`, `Sub`, `SubTrigger`,
  `SubContent`, `RadioGroup`, `RadioItem`.

### Sidebar
- **New** `apps/web/src/components/sidebar-more.tsx` (`"use client"`) — the `SidebarMore` component:
  the "More" trigger styled like a `NavLink` plus the dropdown content described in UX. It owns the
  logout handler (`signOut` + redirect) and reads `usePathname()` for the `/settings` active state and
  `useTheme()` for the theme radio.
- **`apps/web/src/components/app-sidebar.tsx`** — remove the `SECONDARY` (Settings) `NavLink` and the
  `<LogoutButton/>` from the bottom group; render `<SidebarMore/>` there instead. The `SECONDARY`
  array and the unused `Settings` import are removed. `NavLink`/`isActive` stay (still used by
  `SidebarMore` either by reuse or by mirroring the same classnames — see note).
- **`apps/web/src/components/logout-button.tsx`** — **deleted**; its logic moves into `SidebarMore`.

**Reuse note:** to keep the trigger visually identical to nav items without exporting internals, the
`NavLink` button styling is reproduced on the `DropdownMenuTrigger` (it's a `<button>`, not a
`<Link>`). The shared class string is small; if it drifts we can extract a `railItemClass` helper, but
that's not required now (YAGNI).

## Data flow

```
RootLayout
  <html suppressHydrationWarning>
    ThemeProvider (next-themes, attribute="class")        → toggles .dark on <html>
      AppLayout → AppSidebar
        bottom group: <SidebarMore/>
          DropdownMenuTrigger (More, ⋯)  [active when /settings or menu open]
          DropdownMenuContent (side=right, align=end)
            Item: Settings        → /settings
            Sub: Theme
              RadioGroup value={theme} onValueChange={setTheme}
                System | Light | Dark
            ── separator ──
            Item: Log out (destructive) → signOut() → router.replace("/login")
```

## Error handling / edge cases

- **Hydration:** next-themes can't resolve the active theme during SSR, so the radio's checked item is
  correct only after mount. The menu is closed on load, so there's no visible mismatch; `<html
  suppressHydrationWarning>` covers the class the inline script sets.
- **Logout failure:** if `signOut()` rejects, surface nothing new beyond current behavior (the
  existing button had no special handling); the menu closes on selection. Keep parity with today's
  logout behavior — no regression, no added complexity.
- **System theme changes:** with `enableSystem`, next-themes follows OS changes live when "System" is
  selected; nothing extra to wire.

## Testing

- **Browser-verify:** the "More" item appears where Settings/Logout were; clicking opens the menu to
  the right. Settings navigates to `/settings`. The Theme submenu opens and shows the current
  selection; choosing Light/Dark/System visibly changes the theme and persists across reload (no
  flash-of-wrong-theme on refresh). System follows the OS appearance. Log out signs out and lands on
  `/login`. The "More" trigger shows the active treatment on `/settings` and while the menu is open.
- **No unit tests:** this is a presentational/wiring change with no new pure logic to isolate.
