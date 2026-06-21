import { describe, expect, it } from "vitest";
import {
  NO_EDITS,
  hasEdits,
  hasGeometry,
  hasColor,
  rotateLeft,
  rotateRight,
  toggleFlipH,
  toggleFlipV,
  orientedSize,
  coercePhotoEdits,
  previewTransform,
  sameEdits,
  setStraighten,
  setCrop,
  aspectCrop,
} from "./photo-edits.js";

const R = (rotate: 0 | 90 | 180 | 270, flipH = false, flipV = false) => ({ rotate, flipH, flipV });

describe("photo-edits", () => {
  it("NO_EDITS is the identity recipe", () => {
    expect(NO_EDITS).toEqual({ rotate: 0, flipH: false, flipV: false, straighten: 0, crop: null });
  });

  it("hasEdits is false for null and identity, true otherwise", () => {
    expect(hasEdits(null)).toBe(false);
    expect(hasEdits(NO_EDITS)).toBe(false);
    expect(hasEdits({ rotate: 90, flipH: false, flipV: false })).toBe(true);
    expect(hasEdits({ rotate: 0, flipH: true, flipV: false })).toBe(true);
  });

  it("rotateRight/Left step by 90 and wrap mod 360", () => {
    expect(rotateRight(NO_EDITS).rotate).toBe(90);
    expect(rotateRight({ rotate: 270, flipH: false, flipV: false }).rotate).toBe(0);
    expect(rotateLeft(NO_EDITS).rotate).toBe(270);
    expect(rotateLeft({ rotate: 90, flipH: false, flipV: false }).rotate).toBe(0);
  });

  it("flip toggles are axis-aware under 90/270 rotation", () => {
    expect(toggleFlipH(NO_EDITS)).toMatchObject({ flipH: true, flipV: false });
    expect(toggleFlipH({ rotate: 90, flipH: false, flipV: false })).toMatchObject({ flipV: true });
    expect(toggleFlipV({ rotate: 270, flipH: false, flipV: false })).toMatchObject({ flipH: true });
  });

  it("orientedSize swaps on 90/270 only", () => {
    expect(orientedSize(400, 200, NO_EDITS)).toEqual([400, 200]);
    expect(orientedSize(400, 200, { rotate: 90, flipH: false, flipV: false })).toEqual([200, 400]);
    expect(orientedSize(400, 200, { rotate: 180, flipH: false, flipV: false })).toEqual([400, 200]);
    expect(orientedSize(400, 200, { rotate: 270, flipH: true, flipV: false })).toEqual([200, 400]);
  });

  it("orientedSize shrinks for a straighten-only recipe (auto-fill)", () => {
    const [w, h] = orientedSize(100, 100, { rotate: 0, flipH: false, flipV: false, straighten: 45, crop: null });
    expect(w).toBeLessThan(100);
    expect(w).toBeGreaterThan(55);
    expect(Math.abs(w - h)).toBeLessThanOrEqual(2);
  });

  it("coercePhotoEdits accepts valid, rejects malformed/null", () => {
    expect(coercePhotoEdits({ rotate: 90, flipH: true, flipV: false })).toEqual({ rotate: 90, flipH: true, flipV: false, straighten: 0, crop: null });
    expect(coercePhotoEdits(null)).toBeNull();
    expect(coercePhotoEdits({ rotate: 45, flipH: false, flipV: false })).toBeNull();
    expect(coercePhotoEdits({ rotate: 90 })).toBeNull();
    expect(coercePhotoEdits("string")).toBeNull();
  });

  describe("previewTransform (delta over the baked rendition)", () => {
    it("is identity when working === saved (no double-transform)", () => {
      expect(previewTransform(NO_EDITS, NO_EDITS)).toEqual({ deg: 0, mirror: false });
      expect(previewTransform(R(90), R(90))).toEqual({ deg: 0, mirror: false });
      expect(previewTransform(R(180, true), R(180, true))).toEqual({ deg: 0, mirror: false });
    });

    it("equals the absolute recipe when saved is empty", () => {
      expect(previewTransform(null, R(90))).toEqual({ deg: 90, mirror: false });
      expect(previewTransform(NO_EDITS, R(0, true))).toEqual({ deg: 0, mirror: true });
      expect(previewTransform(NO_EDITS, R(180))).toEqual({ deg: 180, mirror: false });
    });

    it("is the incremental delta when re-editing an already-edited photo", () => {
      // Displayed image is rotated 90; one more rotate-right → +90 on screen.
      expect(previewTransform(R(90), R(180))).toEqual({ deg: 90, mirror: false });
      // Undo a saved 90° rotation → rotate the shown image back by 270 (−90).
      expect(previewTransform(R(90), NO_EDITS)).toEqual({ deg: 270, mirror: false });
      // Undo a saved horizontal flip → mirror the shown image again.
      expect(previewTransform(R(0, true), NO_EDITS)).toEqual({ deg: 0, mirror: true });
    });

    it("round-trips: applying the delta to saved yields working (rotation case)", () => {
      // saved=90, working=270 → delta should be +180.
      expect(previewTransform(R(90), R(270))).toEqual({ deg: 180, mirror: false });
    });
  });
});

describe("photo-edits crop & straighten", () => {
  const base = { rotate: 0, flipH: false, flipV: false } as const;

  it("NO_EDITS includes straighten 0 and crop null", () => {
    expect(NO_EDITS).toEqual({ rotate: 0, flipH: false, flipV: false, straighten: 0, crop: null });
  });

  it("hasEdits is true when only straighten or only crop is set", () => {
    expect(hasEdits({ ...base, straighten: 5 })).toBe(true);
    expect(hasEdits({ ...base, crop: { x: 0, y: 0, w: 0.5, h: 0.5 } })).toBe(true);
    expect(hasEdits({ ...base, straighten: 0, crop: null })).toBe(false);
  });

  it("setStraighten clamps to [-45, 45]", () => {
    expect(setStraighten(base, 90).straighten).toBe(45);
    expect(setStraighten(base, -90).straighten).toBe(-45);
    expect(setStraighten(base, 12).straighten).toBe(12);
  });

  it("setCrop sets and clears", () => {
    const c = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
    expect(setCrop(base, c).crop).toEqual(c);
    expect(setCrop({ ...base, crop: c }, null).crop).toBeNull();
  });

  it("sameEdits accounts for straighten and crop", () => {
    expect(sameEdits({ ...base, straighten: 5 }, { ...base, straighten: 5 })).toBe(true);
    expect(sameEdits({ ...base, straighten: 5 }, { ...base, straighten: 6 })).toBe(false);
    expect(sameEdits({ ...base, crop: { x: 0, y: 0, w: 1, h: 1 } }, base)).toBe(false);
  });

  it("aspectCrop('original', …) selects the full oriented frame at 0°", () => {
    const out = aspectCrop(base, "original", 400, 200);
    expect(out.crop?.w).toBeCloseTo(1, 3);
    expect(out.crop?.h).toBeCloseTo(1, 3);
  });

  it("coercePhotoEdits reads new fields and rejects malformed ones", () => {
    expect(coercePhotoEdits({ rotate: 0, flipH: false, flipV: false, straighten: 9 })?.straighten).toBe(9);
    expect(coercePhotoEdits({ rotate: 0, flipH: false, flipV: false, straighten: 999 })?.straighten).toBe(0);
    expect(
      coercePhotoEdits({ rotate: 0, flipH: false, flipV: false, crop: { x: 2, y: 0, w: 1, h: 1 } })?.crop,
    ).toBeNull();
  });

  it("rotateRight transforms the crop into the rotated frame (swaps w/h)", () => {
    const c = setCrop(base, { x: 0.1, y: 0, w: 0.2, h: 1 });
    expect(rotateRight(c).crop).toEqual({ x: 0, y: 0.1, w: 1, h: 0.2 });
  });

  it("rotateLeft is the inverse of rotateRight on the crop", () => {
    const c = setCrop(base, { x: 0.1, y: 0.2, w: 0.3, h: 0.4 });
    const round = rotateLeft(rotateRight(c)).crop!;
    expect(round.x).toBeCloseTo(0.1, 6);
    expect(round.y).toBeCloseTo(0.2, 6);
    expect(round.w).toBeCloseTo(0.3, 6);
    expect(round.h).toBeCloseTo(0.4, 6);
  });

  it("toggleFlipH mirrors the crop on X and negates straighten", () => {
    const e = { ...base, straighten: 10, crop: { x: 0.1, y: 0, w: 0.2, h: 1 } };
    const out = toggleFlipH(e);
    expect(out.crop).toEqual({ x: 0.7, y: 0, w: 0.2, h: 1 });
    expect(out.straighten).toBe(-10);
  });

  it("toggleFlipV mirrors the crop on Y and negates straighten", () => {
    const e = { ...base, straighten: 10, crop: { x: 0, y: 0.1, w: 1, h: 0.2 } };
    const out = toggleFlipV(e);
    expect(out.crop).toEqual({ x: 0, y: 0.7, w: 1, h: 0.2 });
    expect(out.straighten).toBe(-10);
  });

  it("a centered aspect crop stays centered through a rotate", () => {
    const e = aspectCrop(base, "square", 400, 200); // centered square
    const r = rotateRight(e).crop!;
    expect(r.x + r.w / 2).toBeCloseTo(0.5, 6);
    expect(r.y + r.h / 2).toBeCloseTo(0.5, 6);
  });
});

describe("photo-edits color", () => {
  const base = { rotate: 0 as const, flipH: false, flipV: false };

  it("hasGeometry ignores color; hasColor ignores geometry; hasEdits unions them", () => {
    expect(hasGeometry({ ...base, brightness: 50 })).toBe(false);
    expect(hasColor({ ...base, brightness: 50 })).toBe(true);
    expect(hasEdits({ ...base, brightness: 50 })).toBe(true);
    expect(hasGeometry({ ...base, rotate: 90 })).toBe(true);
    expect(hasColor({ ...base, rotate: 90 })).toBe(false);
    expect(hasEdits({ ...base })).toBe(false);
  });

  it("sameEdits compares color fields (absent === 0)", () => {
    expect(sameEdits({ ...base, contrast: 10 }, { ...base, contrast: 10 })).toBe(true);
    expect(sameEdits({ ...base, contrast: 10 }, { ...base, contrast: 11 })).toBe(false);
    expect(sameEdits({ ...base, exposure: 0 }, { ...base })).toBe(true);
  });

  it("coercePhotoEdits clamps color and omits neutral", () => {
    const out = coercePhotoEdits({ ...base, brightness: 50, contrast: 999, exposure: 0 })!;
    expect(out.brightness).toBe(50);
    expect(out.contrast).toBe(100);
    expect(out).not.toHaveProperty("exposure");
    expect(out).not.toHaveProperty("vignette");
  });
});
