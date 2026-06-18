import { describe, expect, it } from "vitest";
import { exifEntries, formatExifValue } from "./exif-entries.js";

describe("formatExifValue", () => {
  it("passes strings through and stringifies scalars", () => {
    expect(formatExifValue("Nikon")).toBe("Nikon");
    expect(formatExifValue(2.8)).toBe("2.8");
    expect(formatExifValue(true)).toBe("true");
  });

  it("JSON-stringifies objects and arrays", () => {
    expect(formatExifValue([1, 2])).toBe("[1,2]");
    expect(formatExifValue({ lat: 1 })).toBe('{"lat":1}');
  });

  it("returns empty string for null", () => {
    expect(formatExifValue(null)).toBe("");
  });
});

describe("exifEntries", () => {
  it("returns entries sorted by key, dropping empty values", () => {
    const rows = exifEntries({
      Model: "FixtureCam",
      FNumber: 2.8,
      cameraMake: "",
      orientation: undefined,
      ISO: 400,
      GPS: { lat: 1 },
    });
    expect(rows).toEqual([
      ["FNumber", "2.8"],
      ["GPS", '{"lat":1}'],
      ["ISO", "400"],
      ["Model", "FixtureCam"],
    ]);
  });

  it("returns an empty array for empty metadata", () => {
    expect(exifEntries({})).toEqual([]);
  });
});
