import type { CurveSpec, CurvePoint, PhotoEdits } from "./types.js";
import { sampleCurve } from "./tone-curve.js";

export type ColorKey =
  | "exposure" | "brightness" | "contrast" | "saturation"
  | "temperature" | "tint" | "hue" | "fade" | "vignette"
  | "highlights" | "shadows" | "whites" | "blacks" | "vibrance";

/** Slider config — drives the edit-panel UI, validation, and reset. */
export interface ColorField {
  key: ColorKey;
  label: string;
  min: number;
  max: number;
  /** Neutral (no-op) value. */
  neutral: number;
  step: number;
  /** Decimal places to display in the panel readout. Defaults to 0 (integer). */
  precision?: number;
}

export const COLOR_FIELDS: ColorField[] = [
  // Light
  { key: "exposure",    label: "Exposure",    min: -5,   max: 5,     neutral: 0,    step: 0.05, precision: 2 },
  { key: "brightness",  label: "Brightness",  min: -100, max: 100,   neutral: 0,    step: 1 },
  { key: "contrast",    label: "Contrast",    min: -100, max: 100,   neutral: 0,    step: 1 },
  { key: "highlights",  label: "Highlights",  min: -100, max: 100,   neutral: 0,    step: 1 },
  { key: "shadows",     label: "Shadows",     min: -100, max: 100,   neutral: 0,    step: 1 },
  { key: "whites",      label: "Whites",      min: -100, max: 100,   neutral: 0,    step: 1 },
  { key: "blacks",      label: "Blacks",      min: -100, max: 100,   neutral: 0,    step: 1 },
  // Color
  { key: "temperature", label: "Temperature", min: 2000, max: 11000, neutral: 6500, step: 10 },
  { key: "tint",        label: "Tint",        min: -150, max: 150,   neutral: 0,    step: 1 },
  { key: "saturation",  label: "Saturation",  min: -100, max: 100,   neutral: 0,    step: 1 },
  { key: "vibrance",    label: "Vibrance",    min: -100, max: 100,   neutral: 0,    step: 1 },
  { key: "hue",         label: "Hue",         min: -180, max: 180,   neutral: 0,    step: 1 },
  // Effects
  { key: "fade",        label: "Fade",        min: -100, max: 100,   neutral: 0,    step: 1 },
  { key: "vignette",    label: "Vignette",    min: -100, max: 100,   neutral: 0,    step: 1 },
];

/** Per-key neutral value. Temperature's neutral is 6500 (K), NOT 0 — so anything
 *  that defaults a missing field MUST use this, never a bare `?? 0`. */
export const NEUTRAL: Record<ColorKey, number> = Object.fromEntries(
  COLOR_FIELDS.map((f) => [f.key, f.neutral]),
) as Record<ColorKey, number>;

// --- tuning constants (the GL preview and the sharp bake share these) ---
const FADE_SCALE = 0.15;          // contrast reduction at fade = 100
const FADE_LIFT = 18;             // black lift (0..255) at fade = 100
const BW_RANGE = 0.25;            // blacks/whites endpoint shift at |value| = 100
const SH_AMT = 0.35;              // shadows region lift at |value| = 100
const HL_AMT = 0.35;              // highlights region shift at |value| = 100
const BRIGHT_GAMMA = 0.7;         // midtone-gamma swing at |brightness| = 100
const VIGNETTE_MAX = 0.6;         // corner alpha at |vignette| = 100
const NEUTRAL_K = 6500;           // temperature where the white-balance matrix is identity
const DUV_MAX = 0.02;             // tint Duv offset at |tint| = 150
const TINT_RANGE = 150;
const TINT_SIGN = -1;             // orientation of +tint → magenta (verified by test)

/** A photo's white-balance baseline: the Temperature(K)/Tint at which the WB
 *  matrix is identity (the as-shot anchor). Estimated at ingest. */
export interface WbBaseline {
  k: number;
  tint: number;
}

/** The global default baseline — identical to the pre-baseline behaviour
 *  (identity at 6500K / 0 tint). Used whenever a photo has no estimated baseline. */
export const DEFAULT_BASELINE: WbBaseline = { k: NEUTRAL_K, tint: 0 };

/** Build a baseline from a photo row / DTO. null/absent columns ⇒ neutral. */
export function wbBaselineOf(p: { asShotTempK?: number | null; asShotTint?: number | null }): WbBaseline {
  return { k: p.asShotTempK ?? NEUTRAL_K, tint: p.asShotTint ?? 0 };
}

/** Field value with the field's *neutral* as the default for a missing key. */
const val = (e: PhotoEdits | null, k: ColorKey): number => e?.[k] ?? NEUTRAL[k];

/** True when any color field is non-neutral. null/absent fields count as neutral. */
export function hasColor(e: PhotoEdits | null): boolean {
  if (!e) return false;
  return COLOR_FIELDS.some((f) => val(e, f.key) !== f.neutral) || hasCurves(e.curves);
}

/** True when a single curve has ≥2 points that deviate from the y=x identity. */
export function hasCurve(pts?: CurvePoint[]): boolean {
  if (!pts || pts.length < 2) return false;
  return pts.some((p) => Math.abs(p.y - p.x) > 1e-6);
}

/** True when a curve spec changes the image (any non-identity master/R/G/B curve). */
export function hasCurves(c?: CurveSpec | null): boolean {
  return !!c && (hasCurve(c.master) || hasCurve(c.r) || hasCurve(c.g) || hasCurve(c.b));
}

// =====================================================================
// Unified color model — one source of truth for the GL preview AND the bake.
//
// Every adjustment is reduced to four renderer-agnostic artifacts, applied in
// this fixed order so the GL shader and `applyColorToRaw` produce the same image:
//   • a LINEAR matrix   (exposure × white-balance CAT), applied in linear light;
//   • a per-channel TONE LUT  (brightness/contrast/highlights/shadows/whites/
//     blacks/fade + curves), sampled over input [0,1] in gamma space;
//   • CHROMA params           (hue, saturation, vibrance), per-pixel, gamma space;
//   • VIGNETTE params         (spatial radial darken/lighten).
// The GL shader samples the LUT as a texture, multiplies the same `mat3`, and
// runs the same chroma/vignette math; `applyColorToRaw` runs the identical math
// on a raw pixel buffer for the bake. Same math ⇒ preview equals save.
// =====================================================================

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** sRGB EOTF (gamma→linear), per channel. Identical to the GLSL `srgbToLinear`. */
export function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
/** Inverse sRGB EOTF (linear→gamma), per channel. Identical to GLSL `linearToSrgb`. */
export function linearToSrgb(c: number): number {
  if (c <= 0) return 0;
  return c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
}

// ---------------------------------------------------------------------
// White balance — a Bradford chromatic-adaptation matrix in linear light.
// The hard color science lives here and is computed ONCE per edit; only the
// resulting 3×3 (9 numbers) cross into the shader, so the GL preview and the
// bake share the exact matrix and can't drift.
// ---------------------------------------------------------------------

type M3 = number[]; // length 9, row-major

// linear sRGB (D65 primaries) ↔ CIE XYZ
const RGB2XYZ: M3 = [
  0.4123908, 0.3575843, 0.1804808,
  0.2126390, 0.7151687, 0.0721923,
  0.0193308, 0.1191948, 0.9505322,
];
const XYZ2RGB: M3 = [
  3.2409699, -1.5373832, -0.4986108,
  -0.9692436, 1.8759675, 0.0415551,
  0.0556301, -0.2039770, 1.0569715,
];
// Bradford cone-response matrix and its inverse (von Kries adaptation)
const BRADFORD: M3 = [
  0.8951, 0.2664, -0.1614,
  -0.7502, 1.7135, 0.0367,
  0.0389, -0.0685, 1.0296,
];
const BRADFORD_INV: M3 = [
  0.9869929, -0.1470543, 0.1599627,
  0.4323053, 0.5183603, 0.0492912,
  -0.0085287, 0.0400428, 0.9684867,
];

function m3mul(a: M3, b: M3): M3 {
  const o = new Array<number>(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      o[r * 3 + c] = a[r * 3]! * b[c]! + a[r * 3 + 1]! * b[3 + c]! + a[r * 3 + 2]! * b[6 + c]!;
    }
  }
  return o;
}
function m3vec(a: M3, v: number[]): number[] {
  return [
    a[0]! * v[0]! + a[1]! * v[1]! + a[2]! * v[2]!,
    a[3]! * v[0]! + a[4]! * v[1]! + a[5]! * v[2]!,
    a[6]! * v[0]! + a[7]! * v[1]! + a[8]! * v[2]!,
  ];
}

/** Planckian locus chromaticity in CIE 1960 UCS (Krystek 1985), valid 1000–15000K. */
function planckUv(K: number): [number, number] {
  const T = K;
  const T2 = T * T;
  const u =
    (0.860117757 + 1.54118254e-4 * T + 1.28641212e-7 * T2) /
    (1 + 8.42420235e-4 * T + 7.08145163e-7 * T2);
  const v =
    (0.317398726 + 4.22806245e-5 * T + 4.20481691e-8 * T2) /
    (1 - 2.89741816e-5 * T + 1.61456053e-7 * T2);
  return [u, v];
}

/** XYZ (Y=1) of the white point for a given Kelvin + tint. Tint offsets the white
 *  perpendicular to the Planckian locus (the green↔magenta / Duv axis). */
function whiteXyz(K: number, tint: number): number[] {
  let [u, v] = planckUv(K);
  if (tint !== 0) {
    const [u1, v1] = planckUv(K * 1.0001);
    const [u0, v0] = planckUv(K * 0.9999);
    let tu = u1 - u0;
    let tv = v1 - v0;
    const len = Math.hypot(tu, tv) || 1e-9;
    tu /= len;
    tv /= len;
    // unit normal to the locus tangent; sign chosen so +tint → magenta image
    const off = TINT_SIGN * (tint / TINT_RANGE) * DUV_MAX;
    u += -tv * off;
    v += tu * off;
  }
  const denom = 2 * u - 8 * v + 4;
  const x = (3 * u) / denom;
  const y = (2 * v) / denom;
  return [x / y, 1, (1 - x - y) / y];
}

/** Linear-sRGB chromatic-adaptation matrix that re-balances the image as if its
 *  neutral were lit at `K`/`tint`, normalized back to the BASELINE white. Identity
 *  at (baseline.k, baseline.tint). Higher K ⇒ bluer source ⇒ warmer result. */
function adaptMatrixRgb(K: number, tint: number, baseline: WbBaseline = DEFAULT_BASELINE): M3 {
  const ws = whiteXyz(K, tint);
  const wd = whiteXyz(baseline.k, baseline.tint);
  const cs = m3vec(BRADFORD, ws);
  const cd = m3vec(BRADFORD, wd);
  const D: M3 = [cd[0]! / cs[0]!, 0, 0, 0, cd[1]! / cs[1]!, 0, 0, 0, cd[2]! / cs[2]!];
  const mXyz = m3mul(BRADFORD_INV, m3mul(D, BRADFORD));
  return m3mul(XYZ2RGB, m3mul(mXyz, RGB2XYZ));
}

/** McCamy's correlated-colour-temperature approximation from CIE 1931 xy. */
function cctFromXy(x: number, y: number): number {
  const n = (x - 0.3320) / (0.1858 - y);
  return 449 * n ** 3 + 3525 * n ** 2 + 6823.3 * n + 5520.33;
}

/** Signed Duv of a CIE-1931 chromaticity from the Krystek Planckian locus at its
 *  own (McCamy) CCT — the perpendicular residual used as the tint axis. Returns
 *  the K used and the Duv so callers can re-reference it. */
function duvFromXy(x: number, y: number): { k: number; duv: number } {
  let k = cctFromXy(x, y);
  k = Math.max(2000, Math.min(11000, k));
  const denom = -2 * x + 12 * y + 3;
  const u = (4 * x) / denom, v = (6 * y) / denom;
  const [u0, v0] = planckUv(k);
  const [u1, v1] = planckUv(k * 1.0001);
  const [u2, v2] = planckUv(k * 0.9999);
  let tu = u1 - u2, tv = v1 - v2;
  const len = Math.hypot(tu, tv) || 1e-9;
  tu /= len; tv /= len;
  // displacement along the locus normal (-tv, tu) — matches whiteXyz's offset axis.
  return { k, duv: (u - u0) * -tv + (v - v0) * tu };
}

// The model's Krystek locus is slightly offset from the true sRGB white (D65), so
// a perfectly neutral grey sits a small constant Duv off the locus. Subtract that
// reference so a neutral capture reads as tint 0 (the default baseline), not ~24.
const D65_REF_DUV = duvFromXy(0.3127, 0.329).duv;

/**
 * Estimate a photo's as-shot white `(k, tint)` from a small decoded RGB buffer
 * (robust gray-world). Because the editor default is identity-at-baseline, a
 * rough estimate only changes the slider's anchor number, never the pixels — so
 * this is deliberately simple. Returns null when no usable (near-neutral, non-
 * black, non-clipped) pixels exist. `channels` may be 3 (RGB) or 4 (RGBA).
 */
export function estimateAsShotWhite(
  rgb: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  channels: number,
): WbBaseline | null {
  const inv = 1 / 255;
  let sr = 0, sg = 0, sb = 0, wsum = 0;
  for (let i = 0; i + channels <= rgb.length; i += channels) {
    const r = rgb[i]! * inv, g = rgb[i + 1]! * inv, b = rgb[i + 2]! * inv;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (luma < 0.02 || luma > 0.98) continue;        // drop near-black / near-clipped
    const sat = mx <= 0 ? 0 : (mx - mn) / mx;
    if (sat > 0.6) continue;                          // drop strongly-coloured pixels
    const w = 1 - sat;                                // weight toward neutral pixels
    sr += srgbToLinear(r) * w;
    sg += srgbToLinear(g) * w;
    sb += srgbToLinear(b) * w;
    wsum += w;
  }
  if (wsum < 1e-6) return null;
  const lr = sr / wsum, lg = sg / wsum, lb = sb / wsum;

  // linear RGB average → XYZ → chromaticity.
  const X = RGB2XYZ[0]! * lr + RGB2XYZ[1]! * lg + RGB2XYZ[2]! * lb;
  const Y = RGB2XYZ[3]! * lr + RGB2XYZ[4]! * lg + RGB2XYZ[5]! * lb;
  const Z = RGB2XYZ[6]! * lr + RGB2XYZ[7]! * lg + RGB2XYZ[8]! * lb;
  const sum = X + Y + Z;
  if (sum <= 0) return null;
  const x = X / sum, y = Y / sum;

  // CCT (McCamy) + signed Duv from the Krystek locus, re-referenced so that a true
  // neutral (D65) grey reads as tint 0 — the model's locus is offset from D65, so
  // without this a neutral capture would estimate a large spurious tint.
  const { k, duv } = duvFromXy(x, y);
  if (!Number.isFinite(k)) return null;
  // whiteXyz offsets along the normal by `off = TINT_SIGN*(tint/TINT_RANGE)*DUV_MAX`,
  // so invert that mapping to recover tint from the re-referenced Duv.
  let tint = TINT_SIGN * ((duv - D65_REF_DUV) / DUV_MAX) * TINT_RANGE;
  tint = Math.max(-150, Math.min(150, tint));

  return { k, tint };
}

/** The linear-light pre-pass matrix: exposure (a uniform scale) folded into the
 *  white-balance CAT. Stored COLUMN-MAJOR for the GL `mat3` uniform. null = identity
 *  (no exposure, neutral white balance). */
export interface LinearParams {
  /** Column-major 3×3 applied to LINEAR-light RGB. */
  m: number[];
}

export function linearParams(
  e: PhotoEdits | null,
  baseline: WbBaseline = DEFAULT_BASELINE,
): LinearParams | null {
  const ev = val(e, "exposure");
  // Temperature/tint default to the photo's baseline when absent — so an unedited
  // photo (no temperature key) is identity, NOT a shift toward 6500.
  const K = e?.temperature ?? baseline.k;
  const tint = e?.tint ?? baseline.tint;
  const wbActive = K !== baseline.k || tint !== baseline.tint;
  if (ev === 0 && !wbActive) return null;
  const r: M3 = wbActive ? adaptMatrixRgb(K, tint, baseline) : [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const s = Math.pow(2, ev); // exposure in stops → linear scale
  // fold exposure (uniform scale) and transpose row-major → column-major
  return {
    m: [
      r[0]! * s, r[3]! * s, r[6]! * s,
      r[1]! * s, r[4]! * s, r[7]! * s,
      r[2]! * s, r[5]! * s, r[8]! * s,
    ],
  };
}

// ---------------------------------------------------------------------
// Tone (gamma space) — per-channel input→output LUT.
// ---------------------------------------------------------------------

/** Keys folded into the tone LUT (a pure input→output curve in gamma space).
 *  Exposure is NOT here — it is a linear-light multiply (see linearParams). */
const TONE_KEYS: ColorKey[] = [
  "brightness", "contrast", "highlights", "shadows", "whites", "blacks", "fade",
];

/** The composed master tonal transfer T(x) for x in [0,1] (curves applied
 *  separately, per channel, by buildToneLut). */
function toneTransfer(e: PhotoEdits | null): (x: number) => number {
  const bright = val(e, "brightness") / 100; // -1..1
  const pBright = Math.pow(2, -bright * BRIGHT_GAMMA); // midtone gamma; 1 = identity
  const c = 1 + val(e, "contrast") / 100;
  const highlights = val(e, "highlights") / 100;
  const shadows = val(e, "shadows") / 100;
  const blackPoint = -(val(e, "blacks") / 100) * BW_RANGE; // blacks>0 ⇒ lift shadows
  const whitePoint = 1 - (val(e, "whites") / 100) * BW_RANGE; // whites>0 ⇒ clip/brighten
  const span = whitePoint - blackPoint || 1e-6;
  const f = val(e, "fade") / 100;
  const fadeScale = 1 - FADE_SCALE * f; // + washes, − punches
  const fadeLift = (FADE_LIFT * f) / 255;
  return (x: number): number => {
    let y = Math.pow(clamp01(x), pBright); // brightness: lift/cut midtones, anchor 0 & 1
    y = (y - 0.5) * c + 0.5; // contrast about mid-grey
    y += shadows * SH_AMT * (1 - smoothstep(0, 0.5, y)); // lift/cut shadow region
    y += highlights * HL_AMT * smoothstep(0.5, 1, y); // lift/cut highlight region
    y = (y - blackPoint) / span; // whites/blacks endpoints
    y = fadeScale * y + fadeLift; // fade
    return clamp01(y);
  };
}

export interface ToneLut {
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
}

/** Interpolated lookup of an n-entry [0,1]→[0,1] table at position x∈[0,1]. */
export function sampleLut(lut: Float32Array, x: number): number {
  const n = lut.length;
  const fx = clamp01(x) * (n - 1);
  const i = Math.floor(fx);
  const a = lut[i]!;
  const b = i + 1 < n ? lut[i + 1]! : a;
  return a + (b - a) * (fx - i);
}

/** Build the per-channel tone LUT (n samples over input [0,1]). Returns null when
 *  no tonal slider and no curve is active (caller treats null as identity). */
export function buildToneLut(e: PhotoEdits | null, n = 256): ToneLut | null {
  if (!e) return null;
  const hasTone = TONE_KEYS.some((k) => val(e, k) !== 0);
  const curves = e.curves;
  if (!hasTone && !hasCurves(curves)) return null;
  const T = toneTransfer(e);
  const masterLut = hasCurve(curves?.master) ? sampleCurve(curves!.master!, n) : null;
  const build = (chPts?: CurvePoint[]): Float32Array => {
    const chLut = hasCurve(chPts) ? sampleCurve(chPts!, n) : null;
    const arr = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let y = T(i / (n - 1));
      if (masterLut) y = sampleLut(masterLut, y);
      if (chLut) y = sampleLut(chLut, y);
      arr[i] = y;
    }
    return arr;
  };
  return { r: build(curves?.r), g: build(curves?.g), b: build(curves?.b) };
}

// ---------------------------------------------------------------------
// Chroma (gamma space) — hue / saturation / vibrance. (Temperature moved to the
// linear pre-pass; it is a white-balance matrix, not a chroma op.)
// ---------------------------------------------------------------------

export interface ChromaParams {
  /** Saturation multiplier (≥0; 1 = neutral). */
  satF: number;
  /** Vibrance amount (-1..1; 0 = neutral). */
  vib: number;
  /** Hue rotation in degrees. */
  hue: number;
}

export function chromaParams(e: PhotoEdits | null): ChromaParams | null {
  const sat = val(e, "saturation");
  const vib = val(e, "vibrance");
  const hue = val(e, "hue");
  if (sat === 0 && vib === 0 && hue === 0) return null;
  return { satF: Math.max(0, 1 + sat / 100), vib: vib / 100, hue };
}

export interface VignetteParams {
  /** Signed corner adjustment: <0 darkens, >0 lightens (magnitude ≤ VIGNETTE_MAX). */
  strength: number;
}

export function vignetteParams(e: PhotoEdits | null): VignetteParams | null {
  const v = val(e, "vignette") / 100; // -1..1
  if (v === 0) return null;
  return { strength: v * VIGNETTE_MAX };
}

export interface ColorModel {
  linear: LinearParams | null;
  tone: ToneLut | null;
  chroma: ChromaParams | null;
  vignette: VignetteParams | null;
}

/** Assemble the full color model. The bake uses a high-resolution tone LUT
 *  (1024 entries) so 16-bit precision isn't quantized; the GL preview can request
 *  a smaller LUT for its texture. */
export function buildColorModel(
  e: PhotoEdits | null,
  toneSamples = 1024,
  baseline: WbBaseline = DEFAULT_BASELINE,
): ColorModel {
  return {
    linear: linearParams(e, baseline),
    tone: buildToneLut(e, toneSamples),
    chroma: chromaParams(e),
    vignette: vignetteParams(e),
  };
}

const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;

/** Luma-preserving hue rotation (same matrix as SVG/CSS hue-rotate). */
function rotateHue(r: number, g: number, b: number, deg: number): [number, number, number] {
  const a = (deg * Math.PI) / 180;
  const c = Math.cos(a);
  const s = Math.sin(a);
  return [
    r * (0.213 + c * 0.787 - s * 0.213) + g * (0.715 - c * 0.715 - s * 0.715) + b * (0.072 - c * 0.072 + s * 0.928),
    r * (0.213 - c * 0.213 + s * 0.143) + g * (0.715 + c * 0.285 + s * 0.14) + b * (0.072 - c * 0.072 - s * 0.283),
    r * (0.213 - c * 0.213 - s * 0.787) + g * (0.715 - c * 0.715 + s * 0.715) + b * (0.072 + c * 0.928 + s * 0.072),
  ];
}

/** Apply the color model to a packed raw buffer (row-major, `channels` per pixel,
 *  channel order R,G,B[,A]; values 0..maxVal). Mutates in place. This is the exact
 *  math the GL shader runs, so the bake matches the live preview. */
export function applyColorToRaw(
  buf: Uint8Array | Uint16Array | Uint8ClampedArray,
  width: number,
  height: number,
  channels: number,
  maxVal: number,
  model: ColorModel,
): void {
  const { linear, tone, chroma, vignette } = model;
  if (!linear && !tone && !chroma && !vignette) return;
  const inv = 1 / maxVal;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * channels;
      let r = buf[o]! * inv;
      let g = buf[o + 1]! * inv;
      let b = buf[o + 2]! * inv;

      if (linear) {
        // Exposure × white balance in LINEAR light, then re-encode to gamma.
        const m = linear.m; // column-major
        const lr = srgbToLinear(r);
        const lg = srgbToLinear(g);
        const lb = srgbToLinear(b);
        r = linearToSrgb(m[0]! * lr + m[3]! * lg + m[6]! * lb);
        g = linearToSrgb(m[1]! * lr + m[4]! * lg + m[7]! * lb);
        b = linearToSrgb(m[2]! * lr + m[5]! * lg + m[8]! * lb);
      }

      if (tone) {
        r = sampleLut(tone.r, r);
        g = sampleLut(tone.g, g);
        b = sampleLut(tone.b, b);
      }

      if (chroma) {
        if (chroma.hue !== 0) [r, g, b] = rotateHue(r, g, b, chroma.hue);
        const l = LUMA_R * r + LUMA_G * g + LUMA_B * b;
        let vf = 1;
        if (chroma.vib !== 0) {
          const mx = Math.max(r, g, b);
          const mn = Math.min(r, g, b);
          const pixSat = mx <= 0 ? 0 : (mx - mn) / mx;
          vf = 1 + chroma.vib * (1 - pixSat);
        }
        const fct = chroma.satF * vf;
        r = l + (r - l) * fct;
        g = l + (g - l) * fct;
        b = l + (b - l) * fct;
      }

      if (vignette) {
        const ux = width > 1 ? x / (width - 1) : 0.5;
        const uy = height > 1 ? y / (height - 1) : 0.5;
        const dx = ux - 0.5;
        const dy = uy - 0.5;
        const d = Math.sqrt(dx * dx + dy * dy) / Math.SQRT1_2; // 0 center → 1 corner
        const k = 1 + vignette.strength * smoothstep(0.45, 1, d); // <0 darken, >0 lighten
        r *= k;
        g *= k;
        b *= k;
      }

      buf[o] = toChannel(r, maxVal);
      buf[o + 1] = toChannel(g, maxVal);
      buf[o + 2] = toChannel(b, maxVal);
    }
  }
}

function toChannel(v: number, maxVal: number): number {
  const s = Math.round(v * maxVal);
  return s < 0 ? 0 : s > maxVal ? maxVal : s;
}
