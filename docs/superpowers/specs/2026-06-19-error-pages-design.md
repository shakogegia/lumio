# Error pages — design

**Date:** 2026-06-19
**Status:** Approved (pending spec review)

## Goal

Replace Next.js's bare default error UI with branded, theme-aware error pages so
that every failure path — a missing record, an unmatched URL, a thrown runtime
error, or a crash in the root layout — lands the user on an intentional Lumio
screen with a clear way out.

## Scope

In scope (App Router special files + one shared component):

- **404 inside the app** — a `not-found.tsx` in the `(app)` route group that
  catches the existing `notFound()` calls in the album and photo pages, keeping
  the sidebar so the user can navigate away.
- **404 at the root** — a top-level `not-found.tsx` for truly unmatched URLs
  (including logged-out visitors and routes outside `(app)`), full-screen with
  the brand mark and no sidebar.
- **Runtime errors inside the app** — an `error.tsx` in `(app)` (Client
  Component) with a "Try again" `reset()` action, keeping the sidebar.
- **Root-layout crash** — a `global-error.tsx` last-resort fallback that renders
  its own `<html>`/`<body>` (no providers, fonts, or theme available).
- **Shared `StatusScreen` component** — the branded centered layout reused by the
  three normal files.

Out of scope (explicitly deferred):

- Per-segment error boundaries beyond `(app)` (e.g. a dedicated `(auth)` error).
- A custom `loading.tsx` / suspense skeletons (not error handling).
- Error reporting / telemetry integration (we `console.error` only; wiring a
  service like Sentry is a separate concern).
- Changing the existing `notFound()` call sites — they light up the new file
  automatically.

## Context

This is a **Next.js 16 App Router** project (`apps/web/src/app`), so error
handling uses App Router special files — `not-found.tsx`, `error.tsx`,
`global-error.tsx` — **not** the Pages Router `pages/404.js` / `pages/_error.js`
approach. The app already calls `notFound()` in:

- `apps/web/src/app/(app)/albums/[id]/page.tsx`
- `apps/web/src/app/(app)/photo/[id]/page.tsx`

…but with no custom `not-found.tsx` present, those currently fall back to Next's
default 404. There are no custom error files anywhere in the project today.

The intercepted photo modal
(`apps/web/src/app/(app)/@modal/(.)photo/[id]/page.tsx`) deliberately does **not**
call `notFound()` (per its in-file comment, to avoid swapping the whole page for
a 404 from within the modal); this design does not touch that behavior.

## Approach

One presentational component (`StatusScreen`) holds all the branded layout and
styling. Each App Router special file is a thin wrapper that supplies its own
status code, headline, description, and actions. `global-error.tsx` is the lone
exception: because it renders outside the root layout (no `ThemeProvider`, no
font CSS variables, no app chrome), it cannot use the themed `StatusScreen` and
instead reimplements a minimal, self-contained version inline that still looks
intentional.

Rejected alternative — duplicating the layout in each file: more code, and four
places to keep visually in sync. A shared component keeps the three normal
screens pixel-identical and makes copy tweaks one-line changes.

## Architecture

### Shared component — `StatusScreen`

`apps/web/src/components/status-screen.tsx` — a Server-Component-safe
presentational component (no hooks, no client directive) so it can be imported by
both server (`not-found.tsx`) and client (`error.tsx`) files.

Props:

```ts
type StatusScreenAction = {
  label: string;
  href?: string;          // renders a Link-style button
  onClick?: () => void;   // renders a plain button (used by error reset)
  variant?: "default" | "outline";
};

type StatusScreenProps = {
  code: string;           // e.g. "404", "500"
  title: string;
  description: string;
  actions: StatusScreenAction[];
  className?: string;     // optional layout overrides
};
```

Layout (uses existing tokens — `bg-background`, `text-foreground`,
`text-muted-foreground`, `font-heading`, and the `Button` + `Logo` primitives):

- Fills its area: `flex min-h-dvh flex-col items-center justify-center`. The
  `(app)` variants render as children of the app layout's `pl-[76px]` div, so
  they **inherit** the sidebar offset and stay optically centered in the visible
  content region with no extra class. The root and `global-error` variants center
  across the full viewport.
- **Brand mark** — `<Logo>` (Aperture) in `text-muted-foreground`, small.
- **Status code** — oversized, `font-heading tracking-tighter` in a faded
  `text-muted-foreground/20`, with the aperture motif sitting subtly behind/beside
  it as a restrained graphic flourish (the agreed "designed moment").
- **Headline** — `font-heading` title.
- **Description** — one `text-muted-foreground` line.
- **Actions** — primary + optional secondary `Button`s in a row; `href` actions
  render the button `asChild` wrapping a `next/link` `Link`, `onClick` actions
  render a normal button.

Fully theme-aware (light/dark) since it relies only on semantic tokens.

### `(app)/not-found.tsx` — in-app 404

Server Component. Renders `StatusScreen` inside the `(app)` layout, so the
sidebar stays visible and the content inherits the layout's `pl-[76px]` offset.
Triggered by the existing `notFound()` calls.

- code `404`, title "This page took a different exposure."
- actions: **Back to library** (`/photos`, default) · *Go to albums* (`/albums`,
  outline).

### `not-found.tsx` (root) — unmatched URLs

Server Component at `apps/web/src/app/not-found.tsx`. Renders within the root
layout only (no `(app)` layout → no sidebar, no auth guard), full-screen.

- code `404`, title "Nothing developed here."
- actions: **Back to library** (`/photos`, default).

### `(app)/error.tsx` — in-app runtime errors

Client Component (`"use client"`), props `{ error, reset }`. `console.error`s the
error in an effect for observability; shows no stack trace to the user. Keeps the
sidebar.

- code `500`, title "Something didn't develop."
- actions: **Try again** (`onClick={reset}`, default) · *Back to library*
  (`/photos`, outline).

### `global-error.tsx` — root-layout crash

Client Component, props `{ error, reset }`. Must render its own `<html>` and
`<body>`. Cannot use `StatusScreen` (no theme/fonts/providers), so it inlines a
minimal centered layout using literal-safe styling that still reads as Lumio
(brand mark + status + message). `console.error`s the error.

- code `500`, title "Lumio hit a snag."
- action: **Reload** (`onClick={reset}`).

## Data flow

1. `notFound()` in `albums/[id]` or `photo/[id]` → nearest `not-found.tsx` is
   `(app)/not-found.tsx` → renders with sidebar.
2. Visiting an unmatched URL → root `app/not-found.tsx` → full-screen 404.
3. A thrown error in any `(app)` route segment → `(app)/error.tsx` boundary
   catches it → "Try again" calls `reset()` to re-render the segment.
4. A throw in the root layout itself → `global-error.tsx` → standalone fallback.

## Error handling & accessibility

- `error.tsx` and `global-error.tsx` log via `console.error(error)` inside a
  `useEffect`; production users never see stack traces or `error.digest`.
- Status screens use semantic structure: the headline is the page's `<h1>`/
  `<h2>`; the large status code is decorative (`aria-hidden`), so screen readers
  read the headline + description, not "404".
- All actions are real `Button`/`Link` elements (keyboard- and SR-accessible).

## Testing

Matching the codebase convention (UI is verified manually in the browser; only
pure helpers get unit tests — see the profile and search specs), these pages are
**verified manually in the browser**:

- Visit a bogus URL (e.g. `/nope`) → root 404.
- Visit a deleted/nonexistent album or photo id → in-app 404 with sidebar.
- Temporarily throw in a route to confirm `(app)/error.tsx` and its "Try again".
- Confirm both light and dark themes render correctly.

There is no pure logic to extract here (these are presentational components), so
no new unit test files are added — consistent with how other UI-only work in this
repo is handled.

## Files

New:

- `apps/web/src/components/status-screen.tsx`
- `apps/web/src/app/not-found.tsx`
- `apps/web/src/app/(app)/not-found.tsx`
- `apps/web/src/app/(app)/error.tsx`
- `apps/web/src/app/global-error.tsx`

Changed:

- *(none — existing `notFound()` call sites are picked up automatically.)*
