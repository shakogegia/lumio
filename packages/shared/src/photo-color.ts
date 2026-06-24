import type { CurveSpec, CurvePoint, PhotoEdits } from "./types.js";
import { sampleCurve } from "./tone-curve.js";

export type ColorKey =
  | "exposure" | "brightness" | "contrast" | "saturation"
  | "temperature" | "hue" | "fade" | "vignette"
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
}

export const COLOR_FIELDS: ColorField[] = [
  // Light
  { key: "exposure",    label: "Exposure",    min: -100, max: 100, neutral: 0, step: 1 },
  { key: "brightness",  label: "Brightness",  min: -100, max: 100, neutral: 0, step: 1 },
  { key: "contrast",    label: "Contrast",    min: -100, max: 100, neutral: 0, step: 1 },
  { key: "highlights",  label: "Highlights",  min: -100, max: 100, neutral: 0, step: 1 },
  { key: "shadows",     label: "Shadows",     min: -100, max: 100, neutral: 0, step: 1 },
  { key: "whites",      label: "Whites",      min: -100, max: 100, neutral: 0, step: 1 },
  { key: "blacks",      label: "Blacks",      min: -100, max: 100, neutral: 0, step: 1 },
  // Color
  { key: "temperature", label: "Temperature", min: -100, max: 100, neutral: 0, step: 1 },
  { key: "saturation",  label: "Saturation",  min: -100, max: 100, neutral: 0, step: 1 },
  { key: "vibrance",    label: "Vibrance",    min: -100, max: 100, neutral: 0, step: 1 },
  { key: "hue",         label: "Hue",         min: -180, max: 180, neutral: 0, step: 1 },
  // Effects
  { key: "fade",        label: "Fade",        min: -100, max: 100, neutral: 0, step: 1 },
  { key: "vignette",    label: "Vignette",    min: 0,    max: 100, neutral: 0, step: 1 },
];

// --- tuning constants (preview overlays and sharp bake share these) ---
const TEMP_WARM = "rgb(255, 150, 40)";
const TEMP_COOL = "rgb(40, 150, 255)";
const TEMP_MAX_OPACITY = 0.5;   // overlay opacity at |temperature| = 100
const TEMP_CHANNEL_GAIN = 0.25; // sharp per-channel R/B swing at |temperature| = 100
const FADE_MAX_OPACITY = 0.12;  // white-overlay opacity at fade = 100
const FADE_SCALE = 0.15;        // sharp contrast reduction at fade = 100
const FADE_LIFT = 18;           // sharp black lift (0..255) at fade = 100
const VIGNETTE_MAX_OPACITY = 0.6; // darkest corner alpha at vignette = 100

const val = (e: PhotoEdits | null, k: ColorKey): number => e?.[k] ?? 0;

// --- normalized getters: the single source of truth ---

/** Combined tonal gain (exposure × brightness). 1 = neutral. */
function gainFactor(e: PhotoEdits | null): number {
  return Math.pow(2, val(e, "exposure") / 50) * (1 + val(e, "brightness") / 100);
}
/** Contrast factor. 1 = neutral. */
function contrastFactor(e: PhotoEdits | null): number {
  return 1 + val(e, "contrast") / 100;
}
/** Saturation factor. 1 = neutral. */
function saturationFactor(e: PhotoEdits | null): number {
  return Math.max(0, 1 + val(e, "saturation") / 100);
}
/** Hue rotation in degrees. 0 = neutral. */
function hueDegrees(e: PhotoEdits | null): number {
  return val(e, "hue");
}

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

// --- CSS preview ---

/** Per-pixel CSS filter chain (exposure/brightness/contrast/saturation/hue, plus
 *  negative fade). "" when neutral. Temperature, positive fade, and vignette are
 *  overlays (colorOverlays). */
export function colorCssFilter(e: PhotoEdits | null): string {
  const parts: string[] = [];
  const g = gainFactor(e);
  const c = contrastFactor(e);
  const s = saturationFactor(e);
  const h = hueDegrees(e);
  // Guards compare against the exact neutral factor (1), which is exact for the
  // integer-stepped sliders; sub-integer programmatic values may still emit a
  // near-neutral filter — that's valid CSS.
  if (g !== 1) parts.push(`brightness(${round(g)})`);
  if (c !== 1) parts.push(`contrast(${round(c)})`);
  if (s !== 1) parts.push(`saturate(${round(s)})`);
  if (h !== 0) parts.push(`hue-rotate(${h}deg)`);
  // Fade is bidirectional: POSITIVE is a matte white-overlay (see colorOverlays);
  // NEGATIVE deepens blacks / adds punch, which CSS expresses here as contrast(>1).
  const fadeF = val(e, "fade") / 100;
  if (fadeF < 0) parts.push(`contrast(${round(1 - FADE_SCALE * fadeF)})`);
  return parts.join(" ");
}

export type OverlayKind = "temperature" | "fade" | "vignette";
export interface ColorOverlay {
  kind: OverlayKind;
  /** CSS background value (color or gradient). */
  background: string;
  blendMode: "soft-light" | "normal";
  /** 0..1 */
  opacity: number;
}

/** Overlay specs for temperature/fade/vignette, in apply order. Empty when neutral.
 *  Sized by the consumer to the final cropped frame. */
export function colorOverlays(e: PhotoEdits | null): ColorOverlay[] {
  const out: ColorOverlay[] = [];
  const temp = val(e, "temperature") / 100; // -1..1
  const fade = val(e, "fade") / 100;          // -1..1 (only positive draws a matte overlay)
  const vig = vignetteStrength(e);            // 0..max
  if (temp !== 0) {
    out.push({
      kind: "temperature",
      background: temp > 0 ? TEMP_WARM : TEMP_COOL,
      blendMode: "soft-light",
      opacity: Math.abs(temp) * TEMP_MAX_OPACITY,
    });
  }
  if (fade > 0) {
    out.push({ kind: "fade", background: "rgb(255,255,255)", blendMode: "normal", opacity: fade * FADE_MAX_OPACITY });
  }
  if (vig > 0) {
    out.push({
      kind: "vignette",
      background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 45%, rgba(0,0,0,${round(vig)}) 100%)`,
      blendMode: "normal",
      opacity: 1,
    });
  }
  return out;
}

// --- sharp bake params (consumed by packages/ingest) ---

export interface ToneLinear { a: number; b: number; }
/** Gain × contrast folded into one scalar linear (a*x + b on 0..255). null = neutral. */
export function toneLinear(e: PhotoEdits | null): ToneLinear | null {
  const g = gainFactor(e);
  const c = contrastFactor(e);
  if (g === 1 && c === 1) return null;
  return { a: c * g, b: 128 * (1 - c) };
}

export interface ModulateParams { saturation: number; hue: number; }
export function modulateParams(e: PhotoEdits | null): ModulateParams | null {
  const s = saturationFactor(e);
  const h = hueDegrees(e);
  if (s === 1 && h === 0) return null;
  return { saturation: s, hue: h };
}

export interface ChannelLinear { a: [number, number, number]; b: [number, number, number]; }
/** Temperature × fade folded into one per-channel [R,G,B] linear. null = neutral. */
export function tempFadeLinear(e: PhotoEdits | null): ChannelLinear | null {
  const t = val(e, "temperature") / 100; // -1..1
  const f = val(e, "fade") / 100;         // -1..1 (negative → scale>1, lift<0 = punch)
  if (t === 0 && f === 0) return null;
  const tempR = 1 + TEMP_CHANNEL_GAIN * t;
  const tempG = 1; // green is unaffected by warm/cool balance
  const tempB = 1 - TEMP_CHANNEL_GAIN * t;
  const scale = 1 - FADE_SCALE * f;
  const lift = FADE_LIFT * f;
  return {
    a: [scale * tempR, scale * tempG, scale * tempB],
    b: [lift, lift, lift],
  };
}

/** Corner-darkening alpha 0..max. 0 = none. */
export function vignetteStrength(e: PhotoEdits | null): number {
  return (val(e, "vignette") / 100) * VIGNETTE_MAX_OPACITY;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// =====================================================================
// Unified color model — one source of truth for the GL preview AND the bake.
//
// Every adjustment is reduced to three renderer-agnostic artifacts:
//   • a per-channel TONE LUT  (exposure/brightness/contrast/highlights/shadows/
//     whites/blacks/fade + curves), sampled over input [0,1];
//   • CHROMA params           (temperature, hue, saturation, vibrance), per-pixel;
//   • VIGNETTE params         (spatial radial darkening).
// The GL shader samples the LUT as a texture and runs the same chroma/vignette
// math; `applyColorToRaw` runs the identical math on a raw pixel buffer for the
// bake. Same math ⇒ preview equals save.
// =====================================================================

/** Keys folded into the tone LUT (everything that is a pure input→output curve). */
const TONE_KEYS: ColorKey[] = [
  "exposure", "brightness", "contrast", "highlights", "shadows", "whites", "blacks", "fade",
];

// Tuning constants for the new tonal sliders (preview and bake share these).
const BW_RANGE = 0.25; // blacks/whites endpoint shift at |value| = 100
const SH_AMT = 0.35;   // shadows region lift at |value| = 100
const HL_AMT = 0.35;   // highlights region shift at |value| = 100

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** The composed master tonal transfer T(x) for x in [0,1] (curves applied
 *  separately, per channel, by buildToneLut). */
function toneTransfer(e: PhotoEdits | null): (x: number) => number {
  const gain = Math.pow(2, val(e, "exposure") / 50) * (1 + val(e, "brightness") / 100);
  const c = 1 + val(e, "contrast") / 100;
  const highlights = val(e, "highlights") / 100;
  const shadows = val(e, "shadows") / 100;
  const blackPoint = -(val(e, "blacks") / 100) * BW_RANGE; // blacks>0 ⇒ lift shadows
  const whitePoint = 1 - (val(e, "whites") / 100) * BW_RANGE; // whites>0 ⇒ clip/brighten
  const span = whitePoint - blackPoint || 1e-6;
  const f = val(e, "fade") / 100;
  const fadeScale = 1 - FADE_SCALE * f; // matches legacy fade: + washes, − punches
  const fadeLift = (FADE_LIFT * f) / 255;
  return (x: number): number => {
    let y = x * gain;
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

export interface ChromaParams {
  /** Saturation multiplier (≥0; 1 = neutral). */
  satF: number;
  /** Vibrance amount (-1..1; 0 = neutral). */
  vib: number;
  /** Hue rotation in degrees. */
  hue: number;
  /** Red / blue channel gain for white balance. */
  tempR: number;
  tempB: number;
}

export function chromaParams(e: PhotoEdits | null): ChromaParams | null {
  const sat = val(e, "saturation");
  const vib = val(e, "vibrance");
  const hue = val(e, "hue");
  const temp = val(e, "temperature") / 100;
  if (sat === 0 && vib === 0 && hue === 0 && temp === 0) return null;
  return {
    satF: Math.max(0, 1 + sat / 100),
    vib: vib / 100,
    hue,
    tempR: 1 + TEMP_CHANNEL_GAIN * temp,
    tempB: 1 - TEMP_CHANNEL_GAIN * temp,
  };
}

export interface VignetteParams {
  /** Corner-darkening strength 0..max. */
  strength: number;
}

export function vignetteParams(e: PhotoEdits | null): VignetteParams | null {
  const s = vignetteStrength(e);
  return s > 0 ? { strength: s } : null;
}

export interface ColorModel {
  tone: ToneLut | null;
  chroma: ChromaParams | null;
  vignette: VignetteParams | null;
}

/** Assemble the full color model. The bake uses a high-resolution tone LUT
 *  (1024 entries) so 16-bit precision isn't quantized; the GL preview can request
 *  a smaller LUT for its texture. */
export function buildColorModel(e: PhotoEdits | null, toneSamples = 1024): ColorModel {
  return {
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
  const { tone, chroma, vignette } = model;
  if (!tone && !chroma && !vignette) return;
  const inv = 1 / maxVal;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * channels;
      let r = buf[o]! * inv;
      let g = buf[o + 1]! * inv;
      let b = buf[o + 2]! * inv;

      if (tone) {
        r = sampleLut(tone.r, r);
        g = sampleLut(tone.g, g);
        b = sampleLut(tone.b, b);
      }

      if (chroma) {
        r *= chroma.tempR;
        b *= chroma.tempB;
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
        const k = 1 - vignette.strength * smoothstep(0.45, 1, d);
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
