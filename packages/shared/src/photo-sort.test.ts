import { describe, expect, it } from "vitest";
import {
  coercePhotoSort,
  DEFAULT_PHOTO_SORT,
  isPhotoSort,
  metadataSort,
  parseMetadataSort,
} from "./api.js";

describe("metadataSort / parseMetadataSort", () => {
  it("round-trips a field id and direction", () => {
    expect(metadataSort("clx1abc", "desc")).toBe("meta:clx1abc:desc");
    expect(parseMetadataSort("meta:clx1abc:desc")).toEqual({ fieldId: "clx1abc", dir: "desc" });
    expect(parseMetadataSort("meta:clx1abc:asc")).toEqual({ fieldId: "clx1abc", dir: "asc" });
  });

  it("returns null for fixed sorts, malformed values, and undefined", () => {
    expect(parseMetadataSort("taken-desc")).toBeNull();
    expect(parseMetadataSort("meta:clx1abc")).toBeNull();
    expect(parseMetadataSort("meta::asc")).toBeNull();
    expect(parseMetadataSort("meta:clx1abc:sideways")).toBeNull();
    expect(parseMetadataSort(undefined)).toBeNull();
  });
});

describe("isPhotoSort", () => {
  it("accepts fixed sorts and well-formed metadata sorts", () => {
    expect(isPhotoSort("imported-desc")).toBe(true);
    expect(isPhotoSort("meta:clx1abc:asc")).toBe(true);
  });
  it("rejects everything else", () => {
    expect(isPhotoSort("nope")).toBe(false);
    expect(isPhotoSort("meta:clx1abc")).toBe(false);
    expect(isPhotoSort(42)).toBe(false);
    expect(isPhotoSort(undefined)).toBe(false);
  });
});

describe("coercePhotoSort", () => {
  it("passes through fixed and metadata sorts, defaults otherwise", () => {
    expect(coercePhotoSort("taken-asc")).toBe("taken-asc");
    expect(coercePhotoSort("meta:clx1abc:desc")).toBe("meta:clx1abc:desc");
    expect(coercePhotoSort("garbage")).toBe(DEFAULT_PHOTO_SORT);
    expect(coercePhotoSort(null)).toBe(DEFAULT_PHOTO_SORT);
  });
});
