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
} from "./photo-color.js";

const base = { rotate: 0 as const, flipH: false, flipV: false };

describe("photo-color", () => {
  it("exposes 8 ordered fields", () => {
    expect(COLOR_FIELDS.map((f) => f.key)).toEqual([
      "exposure", "brightness", "contrast", "saturation",
      "temperature", "hue", "fade", "vignette",
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
});
