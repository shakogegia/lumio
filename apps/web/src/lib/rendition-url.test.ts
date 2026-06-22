import { describe, it, expect } from "vitest";
import { renditionVersion, thumbUrl, displayUrl, baseDisplayUrl } from "@/lib/rendition-url";

const photo = {
  id: "photo-abc",
  updatedAt: "2024-03-15T10:00:00.000Z",
};

describe("renditionVersion", () => {
  it("returns ms since epoch for an ISO date string", () => {
    expect(renditionVersion("2024-03-15T10:00:00.000Z")).toBe(
      Date.parse("2024-03-15T10:00:00.000Z"),
    );
  });
});

describe("thumbUrl", () => {
  it("builds a catalog-scoped thumbnail URL", () => {
    const v = renditionVersion(photo.updatedAt);
    expect(thumbUrl("fam", photo)).toBe(
      `/api/c/fam/photos/${photo.id}/thumbnail?v=${v}`,
    );
  });

  it("encodes slug with special chars", () => {
    const v = renditionVersion(photo.updatedAt);
    expect(thumbUrl("my family", photo)).toBe(
      `/api/c/my%20family/photos/${photo.id}/thumbnail?v=${v}`,
    );
  });
});

describe("displayUrl", () => {
  it("builds a catalog-scoped display URL", () => {
    const v = renditionVersion(photo.updatedAt);
    expect(displayUrl("fam", photo)).toBe(
      `/api/c/fam/photos/${photo.id}/display?v=${v}`,
    );
  });
});

describe("baseDisplayUrl", () => {
  it("builds a catalog-scoped base display URL (no version)", () => {
    expect(baseDisplayUrl("fam", { id: photo.id })).toBe(
      `/api/c/fam/photos/${photo.id}/display?base=1`,
    );
  });
});
