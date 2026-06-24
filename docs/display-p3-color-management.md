# Deferred: Display-P3 / wide-gamut color management

**Status:** Deferred (pickup later). Captured 2026-06-24 alongside the GPU photo-editor work
(`docs/superpowers/specs/2026-06-24-gpu-photo-editor-design.md`).

## What this is, in plain terms

- **sRGB** is the standard color range every screen and web image has used for decades — the safe default that looks right everywhere.
- **Display-P3** is a *wider* range of colors (noticeably richer reds/greens). Apple devices, recent phones, and good monitors support it, and **photos shot on iPhones are often already P3**. Flattening everything to sRGB throws those extra colors away.
- This is **not a user setting**. The right behavior is automatic: serve wide-gamut pixels to screens that can show them, fall back to sRGB everywhere else. Users never pick "P3."

## Why it's deferred

P3 is more work than the 16-bit bake (which we *are* doing now): it requires carrying color-profile information correctly through the *entire* pipeline — store each photo's source color space, process in a defined working space, tag every rendition output, and fall back cleanly. It only benefits photos that actually contain wide-gamut colors. High value for a photographer audience, but a deliberate phase, not a quick toggle.

## Prerequisite already being done

The GPU-editor work processes the bake in **16-bit** and establishes color-managed decode (honoring source ICC into a known working space). That is the foundation P3 builds on, so this becomes a smaller follow-up.

## Pickup plan (sketch)

1. **Ingest:** detect and record each photo's source color space / ICC (iPhone HEIC ≈ Display-P3). Add a `colorSpace` column (or reuse the EXIF/ICC already captured in `Photo.exif`).
2. **Working space:** decide the internal working space. Option A: process in linear Display-P3 and down-convert to sRGB for non-P3 outputs. Option B: process in linear sRGB and only carry P3 through when the source is wide-gamut. (Tie this to the "tone in linear light" refinement noted in the editor spec §5a.)
3. **Renditions:** generate a P3-tagged variant (e.g. `display-p3.webp`/AVIF) in addition to the sRGB rendition; both come out of the same bake with different output transforms. Embed the correct ICC tag on output (today renditions carry none).
4. **Delivery:** detect P3-capable displays client-side (`window.matchMedia('(color-gamut: p3)')` / `(dynamic-range: high)`) and request the P3 rendition; otherwise sRGB. Browsers color-manage tagged images, so an untagged-vs-tagged mistake is the main correctness risk — test on a P3 Mac and a non-P3 screen.
5. **GPU preview:** render the canvas in the matching color space (`<canvas>` `colorSpace: 'display-p3'` is supported) so the live preview matches the wide-gamut output too — preserving WYSIWYG.
6. **Export:** let users choose output format/quality (JPEG/PNG/AVIF); AVIF preserves P3 well. (Export-format choice *is* a reasonable user-facing setting, unlike bit depth/gamut.)

## Reference

- mini-gl supports a `colorspace: 'srgb' | 'display-p3'` rendering option and ICC extraction (via `@xdadda/mini-exif`) — a useful reference implementation for the working-space + canvas color-space handling.
- The editor spec's unified color model (tone LUT + chroma + vignette) is gamut-agnostic; P3 changes the working/output transforms around it, not the slider math.
