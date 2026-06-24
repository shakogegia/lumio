import { describe, expect, it } from "vitest";
import {
  COLOR_FIELDS,
  hasColor,
  colorCssFilter,
  colorOverlays,
  toneLinear,
  modulateParams,
  tempFadeLinear,
  vignetteStrength,
  buildToneLut,
  buildColorModel,
  chromaParams,
  vignetteParams,
  applyColorToRaw,
} from "./photo-color.js";

const base = { rotate: 0 as const, flipH: false, flipV: false };

describe("photo-color", () => {
  it("exposes the ordered color fields", () => {
    expect(COLOR_FIELDS.map((f) => f.key)).toEqual([
      "exposure", "brightness", "contrast", "highlights", "shadows", "whites", "blacks",
      "temperature", "saturation", "vibrance", "hue", "fade", "vignette",
    ]);
  });

  it("hasColor: false when neutral, true for any non-neutral", () => {
    expect(hasColor(null)).toBe(false);
    expect(hasColor({ ...base })).toBe(false);
    expect(hasColor({ ...base, contrast: 10 })).toBe(true);
    expect(hasColor({ ...base, vignette: 5 })).toBe(true);
  });

  it("colorCssFilter: empty when neutral", () => {
    expect(colorCssFilter({ ...base })).toBe("");
  });

  it("colorCssFilter: maps the per-pixel ops", () => {
    expect(colorCssFilter({ ...base, brightness: 100 })).toBe("brightness(2)");
    expect(colorCssFilter({ ...base, contrast: -100 })).toBe("contrast(0)");
    expect(colorCssFilter({ ...base, saturation: 100 })).toBe("saturate(2)");
    expect(colorCssFilter({ ...base, hue: 90 })).toBe("hue-rotate(90deg)");
  });

  it("exposure maps to a power-of-two gain via brightness()", () => {
    expect(colorCssFilter({ ...base, exposure: 50 })).toBe("brightness(2)");
    expect(colorCssFilter({ ...base, exposure: -50 })).toBe("brightness(0.5)");
  });

  it("colorCssFilter composes exposure and brightness multiplicatively", () => {
    expect(colorCssFilter({ ...base, exposure: 50, brightness: 100 })).toBe("brightness(4)");
  });

  it("colorOverlays: only present fields, with expected shape", () => {
    expect(colorOverlays({ ...base })).toEqual([]);
    const warm = colorOverlays({ ...base, temperature: 100 });
    expect(warm[0]!.kind).toBe("temperature");
    expect(warm[0]!.opacity).toBeCloseTo(0.5, 3);
    const vig = colorOverlays({ ...base, vignette: 100 });
    expect(vig[0]!.kind).toBe("vignette");
    expect(vig[0]!.background).toContain("radial-gradient");
  });

  it("toneLinear: null when neutral, folds gain×contrast", () => {
    expect(toneLinear({ ...base })).toBeNull();
    expect(toneLinear({ ...base, brightness: 100 })).toEqual({ a: 2, b: 0 });
    const c = toneLinear({ ...base, contrast: 100 })!; // c = 2
    expect(c.a).toBeCloseTo(2, 6);
    expect(c.b).toBeCloseTo(-128, 6); // 128*(1-2)
  });

  it("modulateParams: null when neutral else sat/hue", () => {
    expect(modulateParams({ ...base })).toBeNull();
    expect(modulateParams({ ...base, saturation: 100 })).toEqual({ saturation: 2, hue: 0 });
  });

  it("tempFadeLinear: null when neutral; warm boosts R over B", () => {
    expect(tempFadeLinear({ ...base })).toBeNull();
    const warm = tempFadeLinear({ ...base, temperature: 100 })!;
    expect(warm.a[0]).toBeGreaterThan(warm.a[2]);
  });

  it("vignetteStrength: 0 neutral, scales to max", () => {
    expect(vignetteStrength({ ...base })).toBe(0);
    expect(vignetteStrength({ ...base, vignette: 100 })).toBeCloseTo(0.6, 6);
  });

  it("fade ranges -100..100 in COLOR_FIELDS", () => {
    const fade = COLOR_FIELDS.find((f) => f.key === "fade")!;
    expect([fade.min, fade.max]).toEqual([-100, 100]);
  });

  it("positive fade is a matte overlay (no filter contrast)", () => {
    expect(colorCssFilter({ ...base, fade: 100 })).toBe("");
    const ov = colorOverlays({ ...base, fade: 100 });
    expect(ov[0]!.kind).toBe("fade");
    expect(ov[0]!.opacity).toBeGreaterThan(0);
  });

  it("negative fade adds punch via contrast(>1) and draws no overlay", () => {
    const filter = colorCssFilter({ ...base, fade: -100 });
    expect(filter).toMatch(/^contrast\(/);
    const c = Number(filter.match(/contrast\(([\d.]+)\)/)![1]);
    expect(c).toBeGreaterThan(1);
    expect(colorOverlays({ ...base, fade: -100 })).toEqual([]);
  });

  it("negative fade bakes as a punch linear (scale>1, lift<0)", () => {
    const lin = tempFadeLinear({ ...base, fade: -100 })!;
    expect(lin.a[1]).toBeGreaterThan(1);
    expect(lin.b[0]).toBeLessThan(0);
  });
});

describe("unified color model", () => {
  it("hasColor: true for the new sliders and non-identity curves", () => {
    expect(hasColor({ ...base, highlights: 10 })).toBe(true);
    expect(hasColor({ ...base, vibrance: -5 })).toBe(true);
    expect(hasColor({ ...base, curves: { master: [{ x: 0, y: 0 }, { x: 0.5, y: 0.7 }, { x: 1, y: 1 }] } })).toBe(true);
    expect(hasColor({ ...base, curves: { master: [{ x: 0, y: 0 }, { x: 1, y: 1 }] } })).toBe(false); // identity
  });

  it("buildToneLut: null when neutral", () => {
    expect(buildToneLut({ ...base })).toBeNull();
  });

  it("buildToneLut: brightness doubles midtones, clamps at the top", () => {
    const lut = buildToneLut({ ...base, brightness: 100 }, 256)!;
    expect(lut.r[64]).toBeCloseTo(0.5, 2); // 0.25 × 2
    expect(lut.r[255]).toBeCloseTo(1, 5);
  });

  it("buildToneLut: blacks+ lifts the black end; whites- lowers the white end", () => {
    expect(buildToneLut({ ...base, blacks: 100 }, 256)!.r[0]).toBeGreaterThan(0.02);
    expect(buildToneLut({ ...base, whites: -100 }, 256)!.r[255]).toBeLessThan(0.98);
  });

  it("buildToneLut: highlights- darkens highlights, leaves shadows ~0", () => {
    const lut = buildToneLut({ ...base, highlights: -100 }, 256)!;
    expect(lut.r[255]).toBeLessThan(0.95);
    expect(lut.r[0]).toBeCloseTo(0, 2);
  });

  it("buildToneLut: shadows+ lifts shadows, leaves whites ~1", () => {
    const lut = buildToneLut({ ...base, shadows: 100 }, 256)!;
    expect(lut.r[0]).toBeGreaterThan(0.05);
    expect(lut.r[255]).toBeCloseTo(1, 2);
  });

  it("buildToneLut: a master curve raises the transfer", () => {
    const lut = buildToneLut(
      { ...base, curves: { master: [{ x: 0, y: 0 }, { x: 0.5, y: 0.75 }, { x: 1, y: 1 }] } },
      256,
    )!;
    expect(lut.r[128]).toBeGreaterThan(0.6);
  });

  it("chromaParams: null when neutral; surfaces values; warm boosts R over B", () => {
    expect(chromaParams({ ...base })).toBeNull();
    const c = chromaParams({ ...base, saturation: 100, vibrance: 50, hue: 30, temperature: 100 })!;
    expect(c.satF).toBeCloseTo(2, 6);
    expect(c.vib).toBeCloseTo(0.5, 6);
    expect(c.hue).toBe(30);
    expect(c.tempR).toBeGreaterThan(c.tempB);
  });

  it("vignetteParams: null at 0, strength otherwise", () => {
    expect(vignetteParams({ ...base })).toBeNull();
    expect(vignetteParams({ ...base, vignette: 100 })!.strength).toBeCloseTo(0.6, 6);
  });

  it("applyColorToRaw: identity model leaves pixels unchanged", () => {
    const buf = new Uint8Array([10, 20, 30, 200, 100, 50]);
    applyColorToRaw(buf, 2, 1, 3, 255, { tone: null, chroma: null, vignette: null });
    expect(Array.from(buf)).toEqual([10, 20, 30, 200, 100, 50]);
  });

  it("applyColorToRaw: saturation -100 ⇒ grey (channels equal)", () => {
    const buf = new Uint8Array([200, 50, 10]);
    applyColorToRaw(buf, 1, 1, 3, 255, buildColorModel({ ...base, saturation: -100 }));
    expect(buf[0]).toBe(buf[1]);
    expect(buf[1]).toBe(buf[2]);
  });

  it("applyColorToRaw: exposure +50 raises a mid-grey pixel", () => {
    const buf = new Uint8Array([100, 100, 100]);
    applyColorToRaw(buf, 1, 1, 3, 255, buildColorModel({ ...base, exposure: 50 }));
    expect(buf[0]).toBeGreaterThan(150);
  });

  it("applyColorToRaw: works on a 16-bit buffer (Uint16Array)", () => {
    const buf = new Uint16Array([30000, 30000, 30000]);
    applyColorToRaw(buf, 1, 1, 3, 65535, buildColorModel({ ...base, exposure: 50 }));
    expect(buf[0]).toBeGreaterThan(45000);
    expect(buf[0]).toBeLessThanOrEqual(65535);
  });
});
