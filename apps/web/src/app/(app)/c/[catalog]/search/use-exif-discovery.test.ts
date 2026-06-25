import { describe, expect, it } from "vitest";
import { normalizeValues, normalizeFields } from "./use-exif-discovery";

describe("discovery normalizers", () => {
  it("normalizeValues keeps {value,count} and tolerates junk", () => {
    expect(normalizeValues({ values: [{ value: "Sony", count: 5 }, { value: "Nikon", count: 2 }] })).toEqual([
      { value: "Sony", count: 5 }, { value: "Nikon", count: 2 },
    ]);
    expect(normalizeValues(null)).toEqual([]);
    expect(normalizeValues({})).toEqual([]);
    expect(normalizeValues({ values: [{ value: "x" }, { count: 1 }, { value: "ok", count: 3 }] })).toEqual([{ value: "ok", count: 3 }]);
  });
  it("normalizeFields returns the string list or []", () => {
    expect(normalizeFields({ fields: ["Make", "ISO"] })).toEqual(["Make", "ISO"]);
    expect(normalizeFields(null)).toEqual([]);
    expect(normalizeFields({ fields: ["ok", 5, null] })).toEqual(["ok"]);
  });
});
