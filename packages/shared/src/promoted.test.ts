import { describe, expect, it } from "vitest";
import { derivePromotedFields } from "./promoted.js";

describe("derivePromotedFields", () => {
  it("maps curated + standard exif keys to columns", () => {
    expect(
      derivePromotedFields({
        cameraMake: "SONY",
        cameraModel: "ILCE-7M4",
        LensModel: "FE 50mm F1.8",
        ISO: 800,
        FNumber: 1.8,
        FocalLength: 50,
        ExposureTime: 0.004,
        latitude: 40.7,
        longitude: -74,
      }),
    ).toEqual({
      cameraMake: "SONY",
      cameraModel: "ILCE-7M4",
      lensModel: "FE 50mm F1.8",
      iso: 800,
      fNumber: 1.8,
      focalLength: 50,
      exposureTime: 0.004,
      hasGps: true,
      gpsLat: 40.7,
      gpsLng: -74,
    });
  });

  it("falls back to Make/Model and ISOSpeedRatings; trims; drops blanks", () => {
    const r = derivePromotedFields({ Make: " Canon ", Model: "EOS R5", ISOSpeedRatings: 100 });
    expect(r.cameraMake).toBe("Canon");
    expect(r.cameraModel).toBe("EOS R5");
    expect(r.iso).toBe(100);
  });

  it("missing / non-numeric / array values → null, hasGps false", () => {
    expect(derivePromotedFields({ ISO: "garbage", FNumber: Number.NaN })).toEqual({
      cameraMake: null, cameraModel: null, lensModel: null, iso: null,
      fNumber: null, focalLength: null, exposureTime: null,
      hasGps: false, gpsLat: null, gpsLng: null,
    });
  });
});
