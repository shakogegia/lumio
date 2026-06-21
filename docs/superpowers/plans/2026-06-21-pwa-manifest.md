# PWA Installability Manifest Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Lumio installable to a home screen / dock so it launches in a standalone window with a black app icon and dark splash — manifest + icons only, no service worker.

**Architecture:** A Next.js App Router `manifest.ts` generates `/manifest.webmanifest` (Next auto-injects the `<link rel="manifest">`). The app icon is the existing Lucide Aperture mark rendered white on a black tile, authored as source SVGs and rasterized to PNG with sharp via a committed generator script. iOS standalone chrome is enabled through an `appleWebApp` block in the root layout metadata.

**Tech Stack:** Next.js 16 (App Router, `MetadataRoute.Manifest`), sharp 0.33 (SVG→PNG rasterization), vitest (unit test).

---

## File Structure

| File | Responsibility |
|------|----------------|
| `apps/web/src/app/manifest.ts` (new) | The web app manifest — installability metadata + icon list. |
| `apps/web/src/app/manifest.test.ts` (new) | Unit test asserting the manifest's key fields. |
| `apps/web/public/icons/icon.svg` (new) | Source art: rounded black tile, white Aperture (~60%), for the `any` icons + apple icon. |
| `apps/web/public/icons/icon-maskable.svg` (new) | Source art: full-bleed black tile, white Aperture (~45%, in the maskable safe zone). |
| `apps/web/scripts/generate-pwa-icons.mjs` (new) | Rasterizes the two source SVGs into the PNG icon set with sharp. |
| `apps/web/public/icons/icon-192.png` (new, generated) | 192×192 `any` icon. |
| `apps/web/public/icons/icon-512.png` (new, generated) | 512×512 `any` icon. |
| `apps/web/public/icons/icon-maskable-512.png` (new, generated) | 512×512 `maskable` icon. |
| `apps/web/src/app/apple-icon.png` (new, generated) | 180×180 iOS home-screen icon (Next file convention → auto `apple-touch-icon` link). |
| `apps/web/src/app/layout.tsx` (modify) | Add `appleWebApp` to the `metadata` export. |
| `apps/web/package.json` (modify) | Add `gen:icons` script. |

All paths below are relative to the repo root `/Users/gego/conductor/workspaces/lumio/kathmandu-v1`.

---

### Task 1: PWA manifest (TDD)

**Files:**
- Create: `apps/web/src/app/manifest.test.ts`
- Create: `apps/web/src/app/manifest.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/app/manifest.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import manifest from "./manifest";

describe("manifest", () => {
  it("is an installable standalone PWA pointing at the photos view", () => {
    const m = manifest();
    expect(m.name).toBe("Lumio");
    expect(m.short_name).toBe("Lumio");
    expect(m.display).toBe("standalone");
    expect(m.start_url).toBe("/photos");
    expect(m.scope).toBe("/");
    expect(m.background_color).toBe("#000000");
    expect(m.theme_color).toBe("#000000");
  });

  it("declares 192 and 512 icons plus a maskable variant", () => {
    const icons = manifest().icons ?? [];
    expect(icons.some((i) => i.sizes === "192x192" && i.purpose === "any")).toBe(true);
    expect(icons.some((i) => i.sizes === "512x512" && i.purpose === "any")).toBe(true);
    expect(icons.some((i) => i.purpose === "maskable")).toBe(true);
    // Every declared icon must live under /icons/.
    expect(icons.every((i) => typeof i.src === "string" && i.src.startsWith("/icons/"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && pnpm vitest run src/app/manifest.test.ts`
Expected: FAIL — cannot resolve `./manifest` (module does not exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/src/app/manifest.ts`:

```ts
import type { MetadataRoute } from "next";

// The web app manifest. Next serves this at /manifest.webmanifest and
// auto-injects <link rel="manifest"> into every page's <head>.
// Installability metadata only — no service worker, no offline behavior.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Lumio",
    short_name: "Lumio",
    description: "Your photo library.",
    // `/` redirects to `/photos`; start there directly to skip the hop on launch.
    start_url: "/photos",
    scope: "/",
    display: "standalone",
    background_color: "#000000",
    theme_color: "#000000",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && pnpm vitest run src/app/manifest.test.ts`
Expected: PASS — both tests green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/manifest.ts apps/web/src/app/manifest.test.ts
git commit -m "feat(web): add PWA web app manifest"
```

---

### Task 2: Icon source SVGs

The Aperture mark (from `apps/web/src/app/icon.svg`) is `circle cx=12 cy=12 r=10` plus six stroked paths on a 24-unit grid. We embed those paths in two 512-unit tiles. Scale 12.8 → mark ≈ 60% of 512 (translate 102.4); scale 9.6 → mark ≈ 45% (translate 140.8), which sits inside the maskable safe zone (inner 80% circle).

**Files:**
- Create: `apps/web/public/icons/icon.svg`
- Create: `apps/web/public/icons/icon-maskable.svg`

- [ ] **Step 1: Create the standard tile**

Create `apps/web/public/icons/icon.svg` (rounded black tile, white mark ~60%):

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="#000000"/>
  <g transform="translate(102.4 102.4) scale(12.8)" fill="none" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <path d="m14.31 8 5.74 9.94"/>
    <path d="M9.69 8h11.48"/>
    <path d="m7.38 12 5.74-9.94"/>
    <path d="M9.69 16 3.95 6.06"/>
    <path d="M14.31 16H2.83"/>
    <path d="m16.62 12-5.74 9.94"/>
  </g>
</svg>
```

- [ ] **Step 2: Create the maskable tile**

Create `apps/web/public/icons/icon-maskable.svg` (full-bleed black, white mark ~45% in the safe zone — note no `rx`, the OS supplies the mask shape):

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#000000"/>
  <g transform="translate(140.8 140.8) scale(9.6)" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="12" cy="12" r="10"/>
    <path d="m14.31 8 5.74 9.94"/>
    <path d="M9.69 8h11.48"/>
    <path d="m7.38 12 5.74-9.94"/>
    <path d="M9.69 16 3.95 6.06"/>
    <path d="M14.31 16H2.83"/>
    <path d="m16.62 12-5.74 9.94"/>
  </g>
</svg>
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/public/icons/icon.svg apps/web/public/icons/icon-maskable.svg
git commit -m "feat(web): add PWA app-icon source SVGs"
```

---

### Task 3: Icon generation script + generated PNGs

**Files:**
- Create: `apps/web/scripts/generate-pwa-icons.mjs`
- Modify: `apps/web/package.json` (add `gen:icons` script)
- Create (generated): `apps/web/public/icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apps/web/src/app/apple-icon.png`

- [ ] **Step 1: Write the generation script**

Create `apps/web/scripts/generate-pwa-icons.mjs`:

```js
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

// Rasterizes the app-icon source SVGs into the PNG set the manifest + iOS need.
// Run with `pnpm gen:icons` whenever the brand mark changes.
const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, "..");
const iconsDir = path.join(webRoot, "public", "icons");
const appDir = path.join(webRoot, "src", "app");

// High render density so downscaled PNGs stay crisp.
const DENSITY = 512;

async function render(svgPath, size, outPath, { flatten = false } = {}) {
  const svg = await readFile(svgPath); // throws (→ exit 1) if the source is missing
  let img = sharp(svg, { density: DENSITY }).resize(size, size);
  if (flatten) img = img.flatten({ background: "#000000" });
  await img.png().toFile(outPath);
  console.log(`  ${path.relative(webRoot, outPath)} (${size}x${size})`);
}

async function main() {
  const icon = path.join(iconsDir, "icon.svg");
  const maskable = path.join(iconsDir, "icon-maskable.svg");

  console.log("Generating PWA icons…");
  await render(icon, 192, path.join(iconsDir, "icon-192.png"));
  await render(icon, 512, path.join(iconsDir, "icon-512.png"));
  await render(maskable, 512, path.join(iconsDir, "icon-maskable-512.png"));
  // iOS home-screen icon: flatten the rounded transparent corners to black
  // (iOS applies its own squircle mask), full-bleed 180px square.
  await render(icon, 180, path.join(appDir, "apple-icon.png"), { flatten: true });
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Add the npm script**

In `apps/web/package.json`, add `gen:icons` to the `scripts` block (after `"test": "vitest run"`, remembering to add a comma):

```json
    "test": "vitest run",
    "gen:icons": "node scripts/generate-pwa-icons.mjs"
```

- [ ] **Step 3: Run the generator**

Run: `cd apps/web && pnpm gen:icons`
Expected output (4 lines, one per icon):
```
Generating PWA icons…
  public/icons/icon-192.png (192x192)
  public/icons/icon-512.png (512x512)
  public/icons/icon-maskable-512.png (512x512)
  src/app/apple-icon.png (180x180)
Done.
```

- [ ] **Step 4: Verify the generated PNG dimensions**

Run:
```bash
cd apps/web && node -e "import('sharp').then(async ({default:sharp})=>{for(const f of ['public/icons/icon-192.png','public/icons/icon-512.png','public/icons/icon-maskable-512.png','src/app/apple-icon.png']){const m=await sharp(f).metadata();console.log(f, m.width+'x'+m.height, m.channels+'ch');}})"
```
Expected:
```
public/icons/icon-192.png 192x192 4ch
public/icons/icon-512.png 512x512 4ch
public/icons/icon-maskable-512.png 512x512 4ch
src/app/apple-icon.png 180x180 3ch
```
(The apple icon is flattened, so 3 channels / no alpha; the others keep alpha → 4 channels.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/scripts/generate-pwa-icons.mjs apps/web/package.json \
  apps/web/public/icons/icon-192.png apps/web/public/icons/icon-512.png \
  apps/web/public/icons/icon-maskable-512.png apps/web/src/app/apple-icon.png
git commit -m "feat(web): generate PWA + apple-touch icon PNGs"
```

---

### Task 4: iOS standalone metadata

**Files:**
- Modify: `apps/web/src/app/layout.tsx:30-35` (the `metadata` export)

- [ ] **Step 1: Add `appleWebApp` to the metadata export**

In `apps/web/src/app/layout.tsx`, replace the existing `metadata` export:

```ts
export const metadata: Metadata = {
  // `default` covers routes without their own title (e.g. the redirect index);
  // `template` wraps each page's `title` export, so "Photos" → "Photos · Lumio".
  title: { default: "Lumio", template: "%s · Lumio" },
  description: "Your photo library.",
};
```

with:

```ts
export const metadata: Metadata = {
  // `default` covers routes without their own title (e.g. the redirect index);
  // `template` wraps each page's `title` export, so "Photos" → "Photos · Lumio".
  title: { default: "Lumio", template: "%s · Lumio" },
  description: "Your photo library.",
  // iOS home-screen launch: standalone chrome + a black status bar to match the
  // dark splash. (The manifest already covers Android/desktop installability.)
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Lumio",
  },
};
```

- [ ] **Step 2: Verify it typechecks**

Run: `cd apps/web && pnpm exec tsc --noEmit -p tsconfig.json`
Expected: no errors from `layout.tsx`. (Per project memory, `tsc` is not a clean gate across the monorepo — pre-existing errors in other files are acceptable; there must be no NEW error referencing `layout.tsx` or `appleWebApp`.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/layout.tsx
git commit -m "feat(web): enable iOS standalone web-app chrome"
```

---

### Task 5: Verification

**Files:** none (verification only)

- [ ] **Step 1: Run the manifest test + lint**

Run: `cd apps/web && pnpm vitest run src/app/manifest.test.ts && pnpm lint`
Expected: test suite passes; lint reports no new errors in the touched files.

- [ ] **Step 2: Confirm the manifest is served and well-formed**

Start the dev server (`cd apps/web && pnpm dev`) in one terminal, then in another:
```bash
curl -fsS http://localhost:3000/manifest.webmanifest | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const m=JSON.parse(s);console.log('display:',m.display,'| start_url:',m.start_url,'| icons:',m.icons.length);})"
```
Expected: `display: standalone | start_url: /photos | icons: 3`
(If running behind the Conductor proxy, substitute the workspace origin `http://<workspace>.lumio.localhost` for `http://localhost:3000`.)

- [ ] **Step 3: Manual installability check**

In Chrome with the app open: DevTools → Application → Manifest. Confirm:
- Name "Lumio", display "standalone", no errors/warnings.
- All three icons load (192, 512, 512-maskable) and preview as a white aperture on black.
- The "Add to Home screen" / install affordance is offered.

Stop the dev server when done. No commit (verification only).

---

### Task 6: Make the manifest publicly reachable

**Added during Task 5 verification.** The auth middleware (`apps/web/src/proxy.ts`) gates all routes except static-asset extensions and a small public allow-list. Its matcher already skips `.png`/`.svg`/`.ico`/`.xml`/`.txt`/`.woff2?` (so the icons return 200), but `.webmanifest` is not skipped — so `/manifest.webmanifest` was being 307-redirected to `/login` for unauthenticated requests. A manifest must be publicly reachable. Fix: add `webmanifest` to the matcher's extension alternation, treating it like the other static metadata assets.

**Files:**
- Modify: `apps/web/src/proxy.ts` (the `config.matcher` regex)

- [ ] **Step 1: Add `webmanifest` to the matcher skip-list**

In `apps/web/src/proxy.ts`, the `config.matcher` regex currently ends its extension alternation with `...|woff2?)`. Change that group to include `webmanifest`:

```ts
export const config = {
  // Skip Next internals and static asset files; run on everything else.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:png|jpe?g|gif|svg|webp|avif|ico|txt|xml|woff2?|webmanifest)$).*)",
  ],
};
```

- [ ] **Step 2: Verify the manifest is now public (200, not 307)**

With the dev server running (it recompiles the proxy on save), confirm an unauthenticated request returns the manifest JSON:
```bash
curl -s -o /dev/null -w "status=%{http_code}\n" http://localhost:55050/manifest.webmanifest
```
Expected: `status=200` (was `307`). Also re-confirm icons still return 200.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/proxy.ts
git commit -m "fix(web): exempt /manifest.webmanifest from auth redirect"
```

---

## Self-Review

**Spec coverage:**
- Icon source SVGs (spec §1) → Task 2 ✓
- Icon generation script + sharp + `gen:icons` (spec §2) → Task 3 ✓
- `manifest.ts` with all listed fields (spec §3) → Task 1 ✓
- iOS `appleWebApp` polish (spec §4) → Task 4 ✓
- Unit test, asset dimension check, manual install check (spec §5 testing) → Task 1 (unit), Task 3 Step 4 (dimensions), Task 5 (manual) ✓
- All "Affected files" from the spec appear in the File Structure table ✓

**Placeholder scan:** No TBD/TODO/"handle edge cases"; every code/SVG/command step shows complete content. ✓

**Type consistency:** Manifest returns `MetadataRoute.Manifest`; icon `src` paths (`/icons/icon-192.png`, `/icons/icon-512.png`, `/icons/icon-maskable-512.png`) are identical in `manifest.ts` (Task 1), the generator outputs (Task 3), and the test's `/icons/` prefix assertion (Task 1). `apple-icon.png` lands in `src/app/` (Next convention) in both the script and the File Structure table. ✓
