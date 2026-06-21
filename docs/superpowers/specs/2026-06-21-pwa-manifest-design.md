# PWA Installability Manifest — Design

**Date:** 2026-06-21
**Status:** Approved
**Scope:** `apps/web`

## Goal

Make Lumio installable to a home screen / dock so it launches in its own
standalone window with a proper app icon and a dark splash screen. This is a
**manifest-only** effort: installability metadata + icons. No service worker, no
offline behavior, no caching.

### Non-goals (explicitly out of scope)

- Service worker / offline app shell
- Offline photo caching, background sync
- Share-target (receiving shared images from the OS)
- Push notifications

These can be layered on later as separate projects.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Scope | Manifest only (installability) | Lumio is almost entirely live server data; a service worker adds stale-cache risk for little gain. |
| Icon treatment | Black rounded tile, white Aperture mark | Matches the near-black foreground; reads well in both OS themes; a transparent line icon looks weak / gets clipped by maskable masks. |
| Splash & status-bar colors | Dark — black `background_color` + black `theme_color` | Cohesive with the black icon tile; consistent premium launch regardless of OS theme. |
| `start_url` | `/photos` | `/` redirects to `/photos`; pointing directly avoids a redirect hop on launch. |

## Architecture / Components

The brand mark is the Lucide **Aperture** icon (already used by `components/logo.tsx`
and `app/icon.svg`). Theme palette is neutral grayscale: white background in
light mode, `oklch(0.145)` (≈ `#252525`) near-black foreground.

### 1. Icon source SVGs (new)

Location: `apps/web/public/icons/`

- `icon.svg` — black rounded tile with the white Aperture mark at normal scale.
  Used to generate the `any`-purpose icons.
- `icon-maskable.svg` — same tile, Aperture inset to ~70% so it survives
  Android's circular/squircle mask safe zone. Used for the `maskable` icon.

Committing the SVGs gives the PNGs a regenerable source of truth.

### 2. Icon generation script (new)

`apps/web/scripts/generate-pwa-icons.mjs`

- Uses **sharp** (already a repo dependency; `serverExternalPackages` in
  `next.config.ts`) to rasterize the two source SVGs into PNGs.
- Outputs (committed):
  - `public/icons/icon-192.png` — 192×192, purpose `any`
  - `public/icons/icon-512.png` — 512×512, purpose `any`
  - `public/icons/icon-maskable-512.png` — 512×512, purpose `maskable`
  - `app/apple-icon.png` — 180×180 (Next file convention → auto-emits the iOS
    `apple-touch-icon` link)
- Exposed as a `package.json` script (e.g. `gen:icons`) so the brand can be
  regenerated if it changes.
- Idempotent; fails loudly if a source SVG is missing.

### 3. The manifest (new)

`apps/web/src/app/manifest.ts` — default export returning
`MetadataRoute.Manifest`. Next serves it at `/manifest.webmanifest` and
**auto-injects `<link rel="manifest">`** (no layout edit needed for the link).

```ts
{
  name: "Lumio",
  short_name: "Lumio",
  description: "Your photo library.", // matches existing layout metadata
  start_url: "/photos",
  scope: "/",
  display: "standalone",
  background_color: "#000000",
  theme_color: "#000000",
  icons: [
    { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
}
```

### 4. iOS standalone polish

Add an `appleWebApp` block to the `metadata` export in `app/layout.tsx`:

```ts
appleWebApp: {
  capable: true,
  statusBarStyle: "black-translucent",
  title: "Lumio",
}
```

So an iOS home-screen launch gets standalone chrome plus a black status bar
that matches the dark splash. The existing `app/icon.svg` favicon stays as-is.

## Data flow

Static configuration only. No runtime data, no DB, no API. At build/request
time Next renders `manifest.ts` → `/manifest.webmanifest` and serves the PNGs
from `public/` at `/icons/*`.

## Error handling

- Generation script: throws (non-zero exit) if a source SVG is missing or sharp
  fails, rather than emitting partial/blank icons.
- Manifest itself is a pure config object — no runtime failure modes.

## Testing & verification

- **Unit test** (`apps/web/src/app/manifest.test.ts`, matching the repo's vitest
  pattern): import the manifest function and assert key fields — `name`,
  `display: "standalone"`, `start_url: "/photos"`, and that `icons` includes a
  192 entry, a 512 entry, and a `maskable` entry.
- **Asset check:** confirm each generated PNG exists at its declared pixel
  dimensions (sharp metadata).
- **Manual:** run the app and use Chrome DevTools → Application → Manifest to
  confirm "installable" with no warnings.

## Affected files

- `apps/web/public/icons/icon.svg` (new)
- `apps/web/public/icons/icon-maskable.svg` (new)
- `apps/web/public/icons/icon-192.png` (new, generated)
- `apps/web/public/icons/icon-512.png` (new, generated)
- `apps/web/public/icons/icon-maskable-512.png` (new, generated)
- `apps/web/src/app/apple-icon.png` (new, generated)
- `apps/web/scripts/generate-pwa-icons.mjs` (new)
- `apps/web/src/app/manifest.ts` (new)
- `apps/web/src/app/manifest.test.ts` (new)
- `apps/web/src/app/layout.tsx` (edit — add `appleWebApp`)
- `apps/web/package.json` (edit — add `gen:icons` script)
