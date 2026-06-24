import { describe, expect, it } from "vitest";
import {
  COLOR_FIELDS,
  NEUTRAL,
  hasColor,
  srgbToLinear,
  linearToSrgb,
  linearParams,
  buildToneLut,
  buildColorModel,
  chromaParams,
  vignetteParams,
  applyColorToRaw,
  DEFAULT_BASELINE,
  wbBaselineOf,
  estimateAsShotWhite,
} from "./photo-color.js";

const base = { rotate: 0 as const, flipH: false, flipV: false };

/** Run the bake kernel on a single RGB pixel and return [r,g,b]. */
function px(
  edits: Parameters<typeof buildColorModel>[0],
  r = 128,
  g = 128,
  b = 128,
): [number, number, number] {
  const buf = new Uint8Array([r, g, b]);
  applyColorToRaw(buf, 1, 1, 3, 255, buildColorModel(edits));
  return [buf[0]!, buf[1]!, buf[2]!];
}

describe("photo-color fields", () => {
  it("exposes the ordered color fields (tint after temperature)", () => {
    expect(COLOR_FIELDS.map((f) => f.key)).toEqual([
      "exposure", "brightness", "contrast", "highlights", "shadows", "whites", "blacks",
      "temperature", "tint", "saturation", "vibrance", "hue", "fade", "vignette",
    ]);
  });

  it("temperature neutral is 6500 K; others 0", () => {
    expect(NEUTRAL.temperature).toBe(6500);
    expect(NEUTRAL.exposure).toBe(0);
    expect(NEUTRAL.tint).toBe(0);
  });

  it("exposure is in EV stops; temperature in Kelvin", () => {
    const exp = COLOR_FIELDS.find((f) => f.key === "exposure")!;
    expect([exp.min, exp.max, exp.neutral]).toEqual([-5, 5, 0]);
    const t = COLOR_FIELDS.find((f) => f.key === "temperature")!;
    expect([t.min, t.max, t.neutral]).toEqual([2000, 11000, 6500]);
    expect((t.min + t.max) / 2).toBe(t.neutral); // 6500 centered on the slider
  });
});

describe("hasColor (neutral-aware)", () => {
  it("false when neutral, true for any non-neutral", () => {
    expect(hasColor(null)).toBe(false);
    expect(hasColor({ ...base })).toBe(false);
    expect(hasColor({ ...base, contrast: 10 })).toBe(true);
    expect(hasColor({ ...base, tint: 5 })).toBe(true);
    expect(hasColor({ ...base, vignette: 5 })).toBe(true);
  });

  it("temperature counts only when off neutral (6500), not 0", () => {
    expect(hasColor({ ...base, temperature: 6500 })).toBe(false);
    expect(hasColor({ ...base, temperature: 9000 })).toBe(true);
  });
});

describe("sRGB transfer", () => {
  it("anchors 0 and 1 and round-trips", () => {
    expect(srgbToLinear(0)).toBe(0);
    expect(linearToSrgb(0)).toBe(0);
    expect(srgbToLinear(1)).toBeCloseTo(1, 6);
    expect(linearToSrgb(1)).toBeCloseTo(1, 6);
    for (const x of [0.05, 0.25, 0.5, 0.8]) {
      expect(srgbToLinear(linearToSrgb(x))).toBeCloseTo(x, 5);
    }
  });
});

describe("linearParams (exposure × white balance)", () => {
  it("null at neutral", () => {
    expect(linearParams({ ...base })).toBeNull();
    expect(linearParams({ ...base, exposure: 0, temperature: 6500, tint: 0 })).toBeNull();
  });

  it("pure exposure is a uniform scale of 2^EV", () => {
    const m = linearParams({ ...base, exposure: 1 })!.m;
    expect(m[0]).toBeCloseTo(2, 5);
    expect(m[4]).toBeCloseTo(2, 5);
    expect(m[8]).toBeCloseTo(2, 5);
    expect(m[1]).toBeCloseTo(0, 6); // off-diagonal stays zero (no WB)
  });

  it("white balance alone activates the matrix", () => {
    expect(linearParams({ ...base, temperature: 9000 })).not.toBeNull();
    expect(linearParams({ ...base, tint: 50 })).not.toBeNull();
  });
});

describe("white balance applied to a neutral grey", () => {
  it("higher Kelvin warms (R>B); lower cools (B>R)", () => {
    const [rw, , bw] = px({ ...base, temperature: 9000 });
    expect(rw).toBeGreaterThan(bw);
    const [rc, , bc] = px({ ...base, temperature: 4000 });
    expect(bc).toBeGreaterThan(rc);
  });

  it("positive tint is magenta (G below R,B); negative is green", () => {
    const [rm, gm, bm] = px({ ...base, tint: 150 });
    expect(gm).toBeLessThan(rm);
    expect(gm).toBeLessThan(bm);
    const [rg, gg, bg] = px({ ...base, tint: -150 });
    expect(gg).toBeGreaterThan(rg);
    expect(gg).toBeGreaterThan(bg);
  });
});

describe("exposure applied in linear light", () => {
  it("raises a mid-grey pixel (8-bit)", () => {
    expect(px({ ...base, exposure: 2 }, 128, 128, 128)[0]).toBeGreaterThan(150);
  });

  it("known pixel value pins the linear math (parity anchor)", () => {
    // 128 → srgb→linear → ×2 → linear→srgb → ~176
    const v = px({ ...base, exposure: 1 }, 128, 128, 128)[0]!;
    expect(v).toBeGreaterThanOrEqual(173);
    expect(v).toBeLessThanOrEqual(179);
  });

  it("works on a 16-bit buffer", () => {
    const buf = new Uint16Array([30000, 30000, 30000]);
    applyColorToRaw(buf, 1, 1, 3, 65535, buildColorModel({ ...base, exposure: 2 }));
    expect(buf[0]).toBeGreaterThan(45000);
    expect(buf[0]).toBeLessThanOrEqual(65535);
  });
});

describe("tone LUT", () => {
  it("null when neutral", () => {
    expect(buildToneLut({ ...base })).toBeNull();
  });

  it("brightness is a midtone gamma: lifts mids, anchors 0 and 1", () => {
    const lut = buildToneLut({ ...base, brightness: 100 }, 256)!;
    expect(lut.r[128]).toBeGreaterThan(0.55); // 0.5 → lifted
    expect(lut.r[0]).toBeCloseTo(0, 5); // black anchored
    expect(lut.r[255]).toBeCloseTo(1, 5); // white anchored
  });

  it("negative brightness darkens mids, still anchored", () => {
    const lut = buildToneLut({ ...base, brightness: -100 }, 256)!;
    expect(lut.r[128]).toBeLessThan(0.45);
    expect(lut.r[0]).toBeCloseTo(0, 5);
    expect(lut.r[255]).toBeCloseTo(1, 5);
  });

  it("blacks+ lifts the black end; whites- lowers the white end", () => {
    expect(buildToneLut({ ...base, blacks: 100 }, 256)!.r[0]).toBeGreaterThan(0.02);
    expect(buildToneLut({ ...base, whites: -100 }, 256)!.r[255]).toBeLessThan(0.98);
  });

  it("highlights- darkens highlights, leaves shadows ~0", () => {
    const lut = buildToneLut({ ...base, highlights: -100 }, 256)!;
    expect(lut.r[255]).toBeLessThan(0.95);
    expect(lut.r[0]).toBeCloseTo(0, 2);
  });

  it("shadows+ lifts shadows, leaves whites ~1", () => {
    const lut = buildToneLut({ ...base, shadows: 100 }, 256)!;
    expect(lut.r[0]).toBeGreaterThan(0.05);
    expect(lut.r[255]).toBeCloseTo(1, 2);
  });

  it("a master curve raises the transfer", () => {
    const lut = buildToneLut(
      { ...base, curves: { master: [{ x: 0, y: 0 }, { x: 0.5, y: 0.75 }, { x: 1, y: 1 }] } },
      256,
    )!;
    expect(lut.r[128]).toBeGreaterThan(0.6);
  });
});

describe("chroma", () => {
  it("null when neutral; surfaces sat/vib/hue; temperature is NOT chroma", () => {
    expect(chromaParams({ ...base })).toBeNull();
    expect(chromaParams({ ...base, temperature: 9000 })).toBeNull(); // WB lives in linearParams
    const c = chromaParams({ ...base, saturation: 100, vibrance: 50, hue: 30 })!;
    expect(c.satF).toBeCloseTo(2, 6);
    expect(c.vib).toBeCloseTo(0.5, 6);
    expect(c.hue).toBe(30);
  });

  it("saturation -100 ⇒ grey (channels equal)", () => {
    const [r, g, b] = px({ ...base, saturation: -100 }, 200, 50, 10);
    expect(r).toBe(g);
    expect(g).toBe(b);
  });
});

describe("vignette (bidirectional)", () => {
  it("null at 0; signed strength otherwise", () => {
    expect(vignetteParams({ ...base })).toBeNull();
    expect(vignetteParams({ ...base, vignette: 100 })!.strength).toBeGreaterThan(0);
    expect(vignetteParams({ ...base, vignette: -100 })!.strength).toBeLessThan(0);
  });

  it("negative darkens corners; positive lightens (center ~unchanged)", () => {
    const grid = () => new Uint8Array(Array.from({ length: 9 }, () => [128, 128, 128]).flat());
    const dark = grid();
    applyColorToRaw(dark, 3, 3, 3, 255, buildColorModel({ ...base, vignette: -100 }));
    expect(dark[0]).toBeLessThan(dark[12]!); // corner < center
    expect(dark[12]).toBeCloseTo(128, -1); // center ~unchanged

    const light = grid();
    applyColorToRaw(light, 3, 3, 3, 255, buildColorModel({ ...base, vignette: 100 }));
    expect(light[0]).toBeGreaterThan(light[12]!);
  });
});

describe("applyColorToRaw identity", () => {
  it("identity model leaves pixels unchanged", () => {
    const buf = new Uint8Array([10, 20, 30, 200, 100, 50]);
    applyColorToRaw(buf, 2, 1, 3, 255, { linear: null, tone: null, chroma: null, vignette: null });
    expect(Array.from(buf)).toEqual([10, 20, 30, 200, 100, 50]);
  });
});

describe("white-balance baseline", () => {
  const base = { rotate: 0 as const, flipH: false, flipV: false };

  it("DEFAULT_BASELINE is 6500K / 0 tint", () => {
    expect(DEFAULT_BASELINE).toEqual({ k: 6500, tint: 0 });
  });

  it("absent temperature + custom baseline ⇒ identity (no pixel change)", () => {
    const model = buildColorModel(base, 1024, { k: 5200, tint: 30 });
    expect(model.linear).toBeNull(); // identity ⇒ null linear pre-pass
  });

  it("temperature === baseline.k ⇒ identity", () => {
    const model = buildColorModel({ ...base, temperature: 5200 }, 1024, { k: 5200, tint: 0 });
    expect(model.linear).toBeNull();
  });

  it("default-baseline output is unchanged from today (no baseline arg)", () => {
    // A warm edit with no baseline must match the same edit with DEFAULT_BASELINE.
    const a = buildColorModel({ ...base, temperature: 4000 });
    const b = buildColorModel({ ...base, temperature: 4000 }, 1024, DEFAULT_BASELINE);
    expect(a.linear?.m).toEqual(b.linear?.m);
  });

  it("slider above baseline warms; below cools (grey pixel)", () => {
    // baseline 5000; push slider to 8000 ⇒ warmer ⇒ R > B.
    const warm = new Uint8Array([128, 128, 128]);
    applyColorToRaw(warm, 1, 1, 3, 255, buildColorModel({ ...base, temperature: 8000 }, 1024, { k: 5000, tint: 0 }));
    expect(warm[0]!).toBeGreaterThan(warm[2]!);
    const cool = new Uint8Array([128, 128, 128]);
    applyColorToRaw(cool, 1, 1, 3, 255, buildColorModel({ ...base, temperature: 3000 }, 1024, { k: 5000, tint: 0 }));
    expect(cool[2]!).toBeGreaterThan(cool[0]!);
  });

  it("wbBaselineOf falls back to neutral on null/absent", () => {
    expect(wbBaselineOf({ asShotTempK: null, asShotTint: null })).toEqual({ k: 6500, tint: 0 });
    expect(wbBaselineOf({})).toEqual({ k: 6500, tint: 0 });
    expect(wbBaselineOf({ asShotTempK: 5200, asShotTint: -20 })).toEqual({ k: 5200, tint: -20 });
  });
});

describe("estimateAsShotWhite", () => {
  // Fill a w×h RGB buffer with one sRGB-byte colour.
  const fill = (r: number, g: number, b: number, w = 8, h = 8): Uint8Array => {
    const buf = new Uint8Array(w * h * 3);
    for (let i = 0; i < w * h; i++) { buf[i * 3] = r; buf[i * 3 + 1] = g; buf[i * 3 + 2] = b; }
    return buf;
  };

  it("a neutral grey buffer estimates ≈ 6500K / 0 tint", () => {
    const wb = estimateAsShotWhite(fill(128, 128, 128), 8, 8, 3)!;
    expect(wb).not.toBeNull();
    expect(wb.k).toBeGreaterThan(6000);
    expect(wb.k).toBeLessThan(7000);
    expect(Math.abs(wb.tint)).toBeLessThan(15);
  });

  it("an orange-cast (warm-looking) buffer estimates a LOW K", () => {
    const wb = estimateAsShotWhite(fill(190, 140, 90), 8, 8, 3)!;
    expect(wb.k).toBeLessThan(5500);
  });

  it("a blue-cast (cool-looking) buffer estimates a HIGH K", () => {
    const wb = estimateAsShotWhite(fill(90, 140, 190), 8, 8, 3)!;
    expect(wb.k).toBeGreaterThan(7500);
  });

  it("round-trips a known baseline through whiteXyz at the default (slider==baseline ⇒ identity)", () => {
    // Build the grey whose chromaticity IS the estimated baseline, then confirm
    // editing at temperature=k is identity for that baseline.
    const wb = estimateAsShotWhite(fill(170, 150, 120), 8, 8, 3)!;
    const model = buildColorModel({ rotate: 0, flipH: false, flipV: false, temperature: wb.k, tint: wb.tint }, 1024, wb);
    expect(model.linear).toBeNull(); // editing exactly to the estimate is the identity
  });

  it("returns null when there are no usable pixels (all black)", () => {
    expect(estimateAsShotWhite(fill(0, 0, 0), 8, 8, 3)).toBeNull();
  });

  it("ignores a saturated minority and follows the neutral majority", () => {
    // 60 grey pixels + 4 fully-saturated red ⇒ still ≈ neutral.
    const buf = fill(128, 128, 128, 8, 8);
    for (let i = 0; i < 4; i++) { buf[i * 3] = 255; buf[i * 3 + 1] = 0; buf[i * 3 + 2] = 0; }
    const wb = estimateAsShotWhite(buf, 8, 8, 3)!;
    expect(wb.k).toBeGreaterThan(5800);
    expect(wb.k).toBeLessThan(7200);
  });
});
