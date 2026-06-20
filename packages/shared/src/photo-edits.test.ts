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
} from "./photo-edits.js";

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
});
