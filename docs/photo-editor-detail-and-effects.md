# Photo editor: detail & effects sliders (sharpen / noise / grain → texture / clarity / dehaze)

**Status:** Phased. **v1 is being built now** (design:
`docs/superpowers/specs/2026-06-24-sharpen-noise-grain-sliders-design.md`).
v2 and v3 are deferred — captured here so the path is recorded.

## What this is, in plain terms

Beyond color (exposure, white balance, tone, saturation), Lightroom-style editors
offer **detail** and **effect** controls. We're adding them to the GPU editor in
three deliberate phases, drawn along the one line that actually matters for our
architecture: **does the effect fit in a single render pass, or does it need a
multi-pass blur?**

The editor's hard invariant is **preview == bake**: the WebGL2 shader
(`apps/web/src/features/photo-editor/render/gl-color.ts`, our minimal custom
"mini-gl" renderer `GlColor`) and the Node/Sharp bake
(`packages/shared/src/photo-color.ts#applyColorToRaw`) run the *identical* math so
what you see equals what you save. Every phase below must preserve that.

## The cost model (why the phases split where they do)

- A **pass** = how many times we sweep the image; a **slider** = a parameter fed
  in. Many sliders can share one pass.
- **Per-pixel** effects (grain) and **small fixed-neighborhood** effects (a 3×3
  sharpen / light noise reduction) fit in the **existing single pass** — one read
  of the source neighborhood, gated so a neutral slider costs nothing.
- What forces a **second pass**: a **larger** blur radius (Texture, Clarity) or one
  spatial filter needing another's *finished output* (proper denoise-then-sharpen,
  multi-scale noise reduction). That needs a **ping-pong framebuffer + separable
  blur** added to `GlColor`, and a two-buffer bake.
- **Sharpen, Texture, and Clarity are the same operation at different radii** —
  high-pass (center − blurred), add back. Fine radius = sharpen (v1); medium/large
  = texture/clarity (v2). Build the blur primitive once → all of them fall out.

## Phase v1 — single-pass, free-when-unused (NOW)

Sliders: **Sharpen**, **Sharpen Masking**, **Noise Reduction**, **Grain**,
**Grain Size**. Five additive `PhotoEdits` fields (neutral 0, no migration).
Fixed 3×3 kernel; sharpen/NR read the source neighborhood once and run before the
color pipeline; grain is a per-pixel integer-hash applied last. Full design,
math, and test plan in the spec linked above.

Done means: spatial preview==bake proven on real photos (grain orientation and
edge rows are the parity-sensitive spots).

## Phase v2 — the framebuffer build (DEFERRED, highest-leverage next step)

One focused piece of infrastructure unlocks a whole family:

- **Add to `GlColor`:** an offscreen framebuffer / render-to-texture and a
  **separable Gaussian blur** (two 1-D passes) at a parameterized radius. Mirror
  it in the bake as a separable blur over the raw buffer (two strided passes +
  one scratch buffer).
- **Then these ride the same primitive** (high-pass at radius R, weighted):
  - **Texture** — medium-radius high-pass; bidirectional (− smooths skin,
    + enhances mid-frequency detail).
  - **Clarity** — large-radius local midtone contrast.
  - **Sharpen Radius** — promote v1's fixed 3×3 to a variable radius.
  - **Multi-scale / Color Noise Reduction** — proper luminance+chroma denoise at
    multiple scales (the v1 single-pass denoiser is intentionally modest).
- **Cost:** multi-pass means saves get meaningfully heavier *when these are
  active* (still gated/pay-per-use). The parity surface grows — blur taps, edge
  handling, and pass intermediates must match GPU↔CPU exactly. Budget real test
  effort here.

## Phase v3 — Dehaze (DEFERRED, its own thing)

Not part of the unsharp family. **Dehaze** uses a dark-channel-prior atmospheric
model (estimate airlight + a transmission map, then invert) — a multi-pass CV
algorithm with its own math and its own parity story. Tackle after v2's
framebuffer exists (it can reuse the offscreen-pass plumbing) but design it
separately.

## Reference

- v1 spec: `docs/superpowers/specs/2026-06-24-sharpen-noise-grain-sliders-design.md`
- Color model (shared, preview==bake source of truth):
  `packages/shared/src/photo-color.ts`
- Renderer ("mini-gl"): `apps/web/src/features/photo-editor/render/gl-color.ts`
- Bake: `packages/ingest/src/color-bake.ts`
- `@xdadda/mini-gl` (the external minimal-WebGL reference; not a runtime dep)
  ships sharpen/blur/convolution passes — a useful reference for the v2 separable
  blur and multi-pass plumbing.
