import type { PhotoEdits } from "./types.js";

export type ColorKey =
  | "exposure" | "brightness" | "contrast" | "saturation"
  | "temperature" | "hue" | "fade" | "vignette";

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
  { key: "exposure",    label: "Exposure",    min: -100, max: 100, neutral: 0, step: 1 },
  { key: "brightness",  label: "Brightness",  min: -100, max: 100, neutral: 0, step: 1 },
  { key: "contrast",    label: "Contrast",    min: -100, max: 100, neutral: 0, step: 1 },
  { key: "saturation",  label: "Saturation",  min: -100, max: 100, neutral: 0, step: 1 },
  { key: "temperature", label: "Temperature", min: -100, max: 100, neutral: 0, step: 1 },
  { key: "hue",         label: "Hue",         min: -180, max: 180, neutral: 0, step: 1 },
  { key: "fade",        label: "Fade",        min: 0,    max: 100, neutral: 0, step: 1 },
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
  return COLOR_FIELDS.some((f) => val(e, f.key) !== f.neutral);
}

// --- CSS preview ---

/** Per-pixel CSS filter chain (exposure/brightness/contrast/saturation/hue).
 *  "" when neutral. Temperature/fade/vignette are overlays (colorOverlays). */
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
  const fade = val(e, "fade") / 100;          // 0..1
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
  const f = val(e, "fade") / 100;         // 0..1
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
