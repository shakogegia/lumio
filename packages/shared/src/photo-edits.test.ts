import { describe, expect, it } from "vitest";
import {
  NO_EDITS,
  hasEdits,
  rotateLeft,
  rotateRight,
  toggleFlipH,
  toggleFlipV,
  orientedSize,
  coercePhotoEdits,
  previewTransform,
} from "./photo-edits.js";

const R = (rotate: 0 | 90 | 180 | 270, flipH = false, flipV = false) => ({ rotate, flipH, flipV });

describe("photo-edits", () => {
  it("NO_EDITS is the identity recipe", () => {
    expect(NO_EDITS).toEqual({ rotate: 0, flipH: false, flipV: false });
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

  it("coercePhotoEdits accepts valid, rejects malformed/null", () => {
    expect(coercePhotoEdits({ rotate: 90, flipH: true, flipV: false })).toEqual({ rotate: 90, flipH: true, flipV: false });
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
