# Dark-mode color-label tints

## Problem

The Lightroom-style color labels (`packages/shared/src/color-labels.ts`) are eight
fixed light pastels, e.g. `pink #FFD2CE`, `blue #CAD2EE`. When a photo is labeled,
the pastel tints the card "mat" (the padded surface behind the thumbnail) via an
inline `style={{ backgroundColor: hex }}` in `photo-grid-tile.tsx`.

These hexes are calibrated for a white page, where they read as a soft tint. The
dark theme background is near-black (`--background: oklch(0.145)`). The *same* light
pastel against near-black is a large luminance jump, so each labeled mat reads as a
bright, glowing frame — "too vibrant." The identical hex is used in both themes, so
dark mode never gets a chance to calm the colors down.

## Goal

Calm the labeled mats in dark mode while leaving light mode pixel-identical, keeping
`color-labels.ts` as the single source of truth (no second palette to maintain).

## Approach (chosen: A — programmatic dim)

Move the *value* into an inline CSS variable and let CSS decide how to render it per
theme. In dark mode, blend each pastel toward the normal dark mat surface so a
labeled mat reads as a tinted ordinary mat rather than a glowing one. Hue is
preserved; lightness and chroma drop to match the surface.

Rejected alternatives:
- **B — explicit dark palette** (`hexDark` per label): maximum control but doubles
  the palette to 16 hand-tuned values that drift out of sync.
- **C — smaller colored area in dark mode** (ring/dot instead of full mat): a design
  change rather than a color fix; can be layered on later if desired.

## Changes

Two files, ~6 lines.

### 1. `apps/web/src/components/photo-grid/photo-grid-tile.tsx`

Replace the inline `backgroundColor` with a CSS custom property, and tag the cell so
CSS can target it:

```ts
const labelHex = mode === "card" ? colorLabelHex(photo.colorLabel) : undefined;
const labelStyle = labelHex
  ? ({ "--label-tint": labelHex } as React.CSSProperties)
  : undefined;
```

Add a `label-mat` class to the cell (both the select-mode `<button>` and the `<Link>`)
when `labelHex` is set, e.g. `cn(cellVariants({ mode }), labelHex && "label-mat")`.

### 2. `apps/web/src/app/globals.css`

One rule pair — the only place theme logic lives:

```css
.label-mat {
  background-color: var(--label-tint);
}
.dark .label-mat {
  background-color: color-mix(in oklch, var(--label-tint) 35%, var(--muted));
}
```

`--muted` is `oklch(0.269)` in dark mode (the normal mat color). The `35%` is the
vibrancy dial — lower is calmer, higher is punchier — tuned by feel during manual
testing.

## Notes / safety

- `.label-mat` is unlayered CSS, so it reliably wins over Tailwind's layered
  `bg-muted` utility regardless of source order — no `!important` needed.
- `color-labels.ts` is untouched; still the single source of truth.
- Light mode is visually identical to today (`.label-mat` resolves to the raw hex).

## Verification

Manual (user will test): label photos in card mode, toggle light/dark, confirm light
is unchanged and dark mats are calm but still clearly distinguishable across all eight
colors. Adjust the `35%` knob if needed.
