# Error Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Next.js's default error UI with branded, theme-aware App Router error pages (`not-found`, `error`, `global-error`) backed by one shared `StatusScreen` component.

**Architecture:** A single presentational `StatusScreen` component (logo + oversized status code + headline + description + action buttons, all on semantic tokens) is reused by the root 404, the in-app 404, and the in-app error boundary. `global-error.tsx` is a self-contained client fallback that renders its own `<html>`/`<body>` with **inline styles** — it runs outside the root layout, so Tailwind/theme/fonts from `globals.css` are unavailable to it.

**Tech Stack:** Next.js 16 (App Router), React 19, Tailwind v4 (via `globals.css` `@theme`), shadcn-style `Button`, lucide-react icons.

**Spec:** `docs/superpowers/specs/2026-06-19-error-pages-design.md`

---

## Background the engineer needs

- This is **App Router**, so error handling uses special files, not Pages Router `pages/404.js`:
  - `not-found.tsx` — rendered for unmatched URLs and for `notFound()` calls. Resolution finds the **nearest** `not-found.tsx` up the segment tree.
  - `error.tsx` — a Client Component error boundary for a segment's page + nested children. Receives `{ error, reset }`. **Cannot** catch errors thrown by its own segment's `layout.tsx`.
  - `global-error.tsx` — Client Component, must render its own `<html>`/`<body>`; the catch-all that handles root-layout crashes and anything that bubbles all the way up.
- The app **already** calls `notFound()` in `apps/web/src/app/(app)/albums/[id]/page.tsx` and `.../photo/[id]/page.tsx`. Placing `not-found.tsx` inside the `(app)` route group lights these up automatically — **do not edit those pages**.
- The `(app)/layout.tsx` wraps children in `<div className="min-h-dvh pl-[76px]">` (the 76px sidebar offset). Files inside `(app)` render as those children, so they **inherit** the offset — no extra offset class needed.
- `globals.css` defines `--font-heading` (→ Inter) and the `font-heading` utility, plus semantic tokens (`bg-background`, `text-foreground`, `text-muted-foreground`, `--primary`, etc.). These exist everywhere **except** `global-error.tsx`.
- `Button` (`@/components/ui/button.tsx`) supports `asChild` (renders a radix `Slot`, used to wrap a `next/link` `Link`), `variant` (`default` | `outline` | …), and `size` (`lg` available). `Logo` (`@/components/logo.tsx`) renders the lucide `Aperture` mark in `currentColor`.

## Testing approach (read before starting)

These are **presentational** components with no pure logic to unit-test, matching this repo's convention (UI verified in-browser; only pure helpers get vitest tests — see the profile/search specs). So this plan is **not** TDD; each task creates a file, then verifies with **lint + typecheck**, and Task 5 does the full **browser** verification across light/dark themes.

Per-task verification commands (run from `apps/web`):

- Lint: `pnpm lint` (eslint)
- Typecheck: `pnpm exec tsc --noEmit`

> **Dev-overlay note:** In `next dev`, `error.tsx` and `global-error.tsx` are masked by the dev error overlay. `not-found` is fully testable in dev. To see the real `error`/`global-error` UI, use a production build (`pnpm build && pnpm start`) or dismiss the dev overlay (press Esc) — covered in Task 5.

---

### Task 1: Shared `StatusScreen` component

**Files:**
- Create: `apps/web/src/components/status-screen.tsx`

- [ ] **Step 1: Create the component**

```tsx
import Link from "next/link";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type StatusScreenAction = {
  label: string;
  /** When set, the action renders as a link button (used by navigation actions). */
  href?: string;
  /** When set (and no href), the action renders as a plain button (used by `reset`). */
  onClick?: () => void;
  variant?: "default" | "outline";
};

/**
 * Branded, theme-aware full-area status screen shared by the App Router
 * not-found and error files. Presentational and hook-free so it can be rendered
 * from both Server Components (not-found) and Client Components (error.tsx).
 *
 * NOTE: `global-error.tsx` cannot use this — it renders outside the root layout
 * where `globals.css` (Tailwind + tokens) is not loaded, so it inlines its own
 * styles instead.
 */
export function StatusScreen({
  code,
  title,
  description,
  actions,
  className,
}: {
  code: string;
  title: string;
  description: string;
  actions: StatusScreenAction[];
  className?: string;
}) {
  return (
    <main
      className={cn(
        "flex min-h-dvh flex-col items-center justify-center px-6 text-center",
        className,
      )}
    >
      <div className="flex flex-col items-center gap-6">
        <Logo className="size-7 text-muted-foreground" strokeWidth={1.6} />

        <span
          aria-hidden
          className="font-heading text-[7rem] leading-none font-semibold tracking-tighter text-muted-foreground/20 select-none sm:text-[9rem]"
        >
          {code}
        </span>

        <div className="flex max-w-md flex-col items-center gap-2">
          <h1 className="font-heading text-2xl font-semibold tracking-tight text-balance">
            {title}
          </h1>
          <p className="text-sm/relaxed text-muted-foreground text-balance">
            {description}
          </p>
        </div>

        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          {actions.map((action) =>
            action.href ? (
              <Button
                key={action.label}
                asChild
                size="lg"
                variant={action.variant ?? "default"}
              >
                <Link href={action.href}>{action.label}</Link>
              </Button>
            ) : (
              <Button
                key={action.label}
                size="lg"
                variant={action.variant ?? "default"}
                onClick={action.onClick}
              >
                {action.label}
              </Button>
            ),
          )}
        </div>
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Lint & typecheck**

Run (from `apps/web`): `pnpm lint && pnpm exec tsc --noEmit`
Expected: PASS, no errors referencing `status-screen.tsx`.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/status-screen.tsx
git commit -m "feat(web): add shared StatusScreen component for error pages"
```

---

### Task 2: 404 pages (root + in-app)

**Files:**
- Create: `apps/web/src/app/not-found.tsx`
- Create: `apps/web/src/app/(app)/not-found.tsx`

- [ ] **Step 1: Root `not-found.tsx` (unmatched URLs, no sidebar)**

```tsx
import { StatusScreen } from "@/components/status-screen";

export default function NotFound() {
  return (
    <StatusScreen
      code="404"
      title="Nothing developed here."
      description="The page you're looking for doesn't exist. Let's get you back to your photos."
      actions={[{ label: "Back to library", href: "/photos" }]}
    />
  );
}
```

- [ ] **Step 2: In-app `(app)/not-found.tsx` (keeps sidebar; catches the album/photo `notFound()` calls)**

```tsx
import { StatusScreen } from "@/components/status-screen";

export default function AppNotFound() {
  return (
    <StatusScreen
      code="404"
      title="This page took a different exposure."
      description="We couldn't find what you were looking for. It may have been moved, deleted, or never existed."
      actions={[
        { label: "Back to library", href: "/photos" },
        { label: "Go to albums", href: "/albums", variant: "outline" },
      ]}
    />
  );
}
```

- [ ] **Step 3: Lint & typecheck**

Run (from `apps/web`): `pnpm lint && pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Quick browser check (dev is fine for 404s)**

Run (from repo root): `pnpm dev` (if not already running)
- Visit `http://localhost:3000/this-route-does-not-exist` → root 404 ("Nothing developed here."), **no sidebar**.
- Log in, then visit a bogus album, e.g. `http://localhost:3000/albums/00000000-0000-0000-0000-000000000000` → in-app 404 ("This page took a different exposure."), **sidebar visible**.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/not-found.tsx "apps/web/src/app/(app)/not-found.tsx"
git commit -m "feat(web): add branded 404 pages (root + in-app)"
```

---

### Task 3: In-app error boundary `(app)/error.tsx`

**Files:**
- Create: `apps/web/src/app/(app)/error.tsx`

- [ ] **Step 1: Create the error boundary (Client Component, keeps sidebar)**

```tsx
"use client";

import { useEffect } from "react";
import { StatusScreen } from "@/components/status-screen";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Keep the failure observable in logs; never shown to the user.
    console.error(error);
  }, [error]);

  return (
    <StatusScreen
      code="500"
      title="Something didn't develop."
      description="An unexpected error interrupted this page. You can try again, or head back to your library."
      actions={[
        { label: "Try again", onClick: reset },
        { label: "Back to library", href: "/photos", variant: "outline" },
      ]}
    />
  );
}
```

- [ ] **Step 2: Lint & typecheck**

Run (from `apps/web`): `pnpm lint && pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/(app)/error.tsx"
git commit -m "feat(web): add in-app error boundary page"
```

---

### Task 4: Root fallback `global-error.tsx`

**Files:**
- Create: `apps/web/src/app/global-error.tsx`

**Why inline styles:** `global-error.tsx` replaces the root layout, so `globals.css` (Tailwind utilities + theme tokens + Inter font) is **not** loaded. Tailwind classes would silently do nothing here. It uses inline styles and a fixed neutral-dark palette on purpose — a deliberate, theme-independent crash screen.

- [ ] **Step 1: Create the global fallback**

```tsx
"use client";

import { useEffect } from "react";
import { Aperture } from "lucide-react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1.5rem",
          padding: "1.5rem",
          textAlign: "center",
          backgroundColor: "#0a0a0a",
          color: "#fafafa",
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        }}
      >
        <Aperture
          width={28}
          height={28}
          strokeWidth={1.6}
          color="#a1a1aa"
          aria-hidden
        />

        <div
          aria-hidden
          style={{
            fontSize: "7rem",
            lineHeight: 1,
            fontWeight: 600,
            letterSpacing: "-0.05em",
            color: "rgba(250,250,250,0.12)",
          }}
        >
          500
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "0.5rem",
            maxWidth: "28rem",
          }}
        >
          <h1
            style={{
              margin: 0,
              fontSize: "1.5rem",
              fontWeight: 600,
              letterSpacing: "-0.01em",
            }}
          >
            Lumio hit a snag.
          </h1>
          <p style={{ margin: 0, fontSize: "0.875rem", color: "#a1a1aa" }}>
            Something went wrong on our end. Reloading usually clears it up.
          </p>
        </div>

        <button
          onClick={reset}
          style={{
            marginTop: "0.5rem",
            height: "2.5rem",
            padding: "0 1.25rem",
            borderRadius: "9999px",
            border: "none",
            cursor: "pointer",
            backgroundColor: "#fafafa",
            color: "#0a0a0a",
            fontSize: "0.875rem",
            fontWeight: 500,
          }}
        >
          Reload
        </button>
      </body>
    </html>
  );
}
```

- [ ] **Step 2: Lint & typecheck**

Run (from `apps/web`): `pnpm lint && pnpm exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/global-error.tsx
git commit -m "feat(web): add global-error root fallback page"
```

---

### Task 5: Full verification (build + browser, both themes)

No new files. This task proves the real `error`/`global-error` UI renders (the dev overlay hides them) and that nothing regressed the build.

- [ ] **Step 1: Production build**

Run (from `apps/web`): `pnpm build`
Expected: build succeeds; output lists the routes without errors.

- [ ] **Step 2: Verify `error.tsx` with a temporary throw**

Temporarily add a throw to a server page to trip the boundary — e.g. at the top of the default export in `apps/web/src/app/(app)/photos/page.tsx`:

```tsx
throw new Error("temp: verify error boundary");
```

Run: `pnpm start`, then visit `http://localhost:3000/photos`.
Expected: the in-app error screen ("Something didn't develop.") with the **sidebar still visible**; "Try again" and "Back to library" buttons present.
**Then REVERT the temporary throw.**

- [ ] **Step 3: Verify `global-error.tsx` with a temporary throw**

Temporarily add a throw inside the root layout body to force the global fallback — e.g. at the top of `RootLayout` in `apps/web/src/app/layout.tsx`:

```tsx
throw new Error("temp: verify global error");
```

Rebuild (`pnpm build`), `pnpm start`, visit any route.
Expected: the dark, self-contained "Lumio hit a snag." screen with a "Reload" button (no sidebar, no theme).
**Then REVERT the temporary throw and rebuild.**

- [ ] **Step 4: Theme check on the 404 + error screens**

With `pnpm start` running, view the root 404 (`/nope`) and the in-app 404 (bogus album id) in both **light and dark** themes (toggle via the sidebar "More" menu while logged in, or OS theme for the logged-out root 404).
Expected: text, logo, and the faded status code are legible and on-brand in both themes.

- [ ] **Step 5: Final lint + typecheck (confirm temp throws are gone)**

Run (from `apps/web`): `pnpm lint && pnpm exec tsc --noEmit`
Expected: PASS. Also confirm `git status` shows no leftover edits to `photos/page.tsx` or `layout.tsx`.

- [ ] **Step 6: Commit (only if anything changed; otherwise skip)**

```bash
git status   # expect clean except this plan's checkbox updates
```

---

## Self-Review

**Spec coverage:**
- In-app 404 (keeps sidebar) → Task 2, `(app)/not-found.tsx`. ✓
- Root 404 (no sidebar) → Task 2, `app/not-found.tsx`. ✓
- In-app runtime errors w/ reset → Task 3, `(app)/error.tsx`. ✓
- Root-layout crash fallback → Task 4, `global-error.tsx`. ✓
- Shared `StatusScreen` → Task 1. ✓
- `console.error` only, no stack traces → Tasks 3 & 4. ✓
- Decorative status code (`aria-hidden`), semantic `<h1>` → Task 1 (`aria-hidden` on the code span, `<h1>` headline). ✓
- Manual browser verification across themes → Task 5. ✓
- No edits to existing `notFound()` call sites → confirmed (Files lists create-only). ✓

**Placeholder scan:** No TBD/TODO; every code step shows full file contents. The only intentional temporary code (Task 5 throws) is explicitly reverted in the same task. ✓

**Type consistency:** `StatusScreenAction` shape (`label`, `href?`, `onClick?`, `variant?`) defined in Task 1 is used consistently in Tasks 2–3. `{ error, reset }` prop signature matches Next's API in Tasks 3–4. `StatusScreen` prop names (`code`, `title`, `description`, `actions`) match every call site. ✓
