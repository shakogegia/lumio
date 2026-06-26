import { describe, expect, it } from "vitest";
import {
  StandardFieldKey,
  formatShutter,
  formatAperture,
  formatFocal,
  formatCamera,
  resolveStandardFields,
  standardMetadataLines,
} from "./metadata-standard.js";

describe("formatters", () => {
  it("formats shutter as a reciprocal under 1s and seconds at/above 1s", () => {
    expect(formatShutter(0.01)).toBe("1/100 s");
    expect(formatShutter(0.002)).toBe("1/500 s");
    expect(formatShutter(1)).toBe("1 s");
    expect(formatShutter(2)).toBe("2 s");
    expect(formatShutter(0.5)).toBe("1/2 s");
    expect(formatShutter(undefined)).toBeNull();
    expect(formatShutter(0)).toBeNull();
  });

  it("formats aperture with an f-stop glyph", () => {
    expect(formatAperture(8)).toBe("ƒ/8");
    expect(formatAperture(2.8)).toBe("ƒ/2.8");
    expect(formatAperture(undefined)).toBeNull();
  });

  it("formats focal length in millimetres", () => {
    expect(formatFocal(55)).toBe("55 mm");
    expect(formatFocal(60)).toBe("60 mm");
    expect(formatFocal(undefined)).toBeNull();
  });

  it("joins make + model without duplicating the make", () => {
    expect(formatCamera("SONY", "ILCE-6400")).toBe("SONY ILCE-6400");
    expect(formatCamera("NIKON CORPORATION", "NIKON D800")).toBe("NIKON D800");
    expect(formatCamera(undefined, "ILCE-6400")).toBe("ILCE-6400");
    expect(formatCamera("SONY", undefined)).toBe("SONY");
    expect(formatCamera(undefined, undefined)).toBeNull();
  });
});

describe("resolveStandardFields", () => {
  it("pulls formatted values from an exif blob, preferring curated aliases", () => {
    const r = resolveStandardFields({
      cameraMake: "SONY",
      cameraModel: "ILCE-6400",
      ISO: 3200,
      ExposureTime: 0.002,
      FNumber: 10,
      FocalLength: 55,
      DateTimeOriginal: "2024-08-01T20:38:12.000Z",
    });
    expect(r[StandardFieldKey.Camera]).toBe("SONY ILCE-6400");
    expect(r[StandardFieldKey.Iso]).toBe("ISO 3200");
    expect(r[StandardFieldKey.Shutter]).toBe("1/500 s");
    expect(r[StandardFieldKey.Aperture]).toBe("ƒ/10");
    expect(r[StandardFieldKey.Focal]).toBe("55 mm");
    expect(r[StandardFieldKey.Date]).toBe("Aug 1, 2024");
  });

  it("falls back to Make/Model and yields null for missing fields", () => {
    const r = resolveStandardFields({ Make: "Canon", Model: "EOS R" });
    expect(r[StandardFieldKey.Camera]).toBe("Canon EOS R");
    expect(r[StandardFieldKey.Iso]).toBeNull();
    expect(r[StandardFieldKey.Shutter]).toBeNull();
    expect(r[StandardFieldKey.Date]).toBeNull();
  });
});

describe("standardMetadataLines", () => {
  it("composes the exposure and optics lines", () => {
    const lines = standardMetadataLines({
      cameraMake: "SONY",
      cameraModel: "ILCE-6400",
      ISO: 3200,
      ExposureTime: 0.002,
      FNumber: 10,
      FocalLength: 55,
      DateTimeOriginal: "2024-08-01T20:38:12.000Z",
    });
    expect(lines).toEqual({
      camera: "SONY ILCE-6400",
      exposure: "1/500 s  ISO 3200",
      optics: "ƒ/10  55 mm",
      date: "Aug 1, 2024",
    });
  });

  it("returns null when no standard field is present", () => {
    expect(standardMetadataLines({})).toBeNull();
    expect(standardMetadataLines({ Orientation: 1, ThumbnailLength: 10 })).toBeNull();
  });

  it("includes only the lines that have data", () => {
    const lines = standardMetadataLines({ FNumber: 8 });
    expect(lines).toEqual({ camera: null, exposure: null, optics: "ƒ/8", date: null });
  });
});
