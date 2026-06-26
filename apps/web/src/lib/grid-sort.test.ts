import { describe, expect, it } from "vitest";
import { FieldType, type MetadataSchema } from "@lumio/shared";
import { dateSortFields, effectiveGridSort } from "./grid-sort";

function field(id: string, type: FieldType, enabled = true) {
  return { id, key: id, label: `L-${id}`, type, kind: "custom" as const, builtinKey: null, enabled, suggests: false, options: [] };
}

const schema: MetadataSchema = [
  { id: "g1", label: "G1", fields: [field("d1", FieldType.Date), field("t1", FieldType.Text)] },
  { id: "g2", label: "G2", fields: [field("d2", FieldType.Date), field("d3", FieldType.Date, false)] },
];

describe("dateSortFields", () => {
  it("returns enabled Date fields flattened across groups", () => {
    expect(dateSortFields(schema)).toEqual([
      { id: "d1", label: "L-d1" },
      { id: "d2", label: "L-d2" },
    ]);
  });
});

describe("effectiveGridSort", () => {
  const fields = [{ id: "d1", label: "L-d1" }];
  it("keeps a fixed sort untouched", () => {
    expect(effectiveGridSort("taken-desc", fields)).toBe("taken-desc");
  });
  it("keeps a metadata sort whose field is present", () => {
    expect(effectiveGridSort("meta:d1:asc", fields)).toBe("meta:d1:asc");
  });
  it("falls back when the metadata field is absent from this catalog", () => {
    expect(effectiveGridSort("meta:zzz:asc", fields)).toBe("imported-desc");
  });
  it("keeps a metadata sort as-is while fields are still loading (undefined)", () => {
    expect(effectiveGridSort("meta:zzz:asc", undefined)).toBe("meta:zzz:asc");
  });
});
