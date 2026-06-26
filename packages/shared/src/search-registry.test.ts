import { describe, expect, it } from "vitest";
import { FieldType, FieldKind, RuleOp } from "./enums.js";
import { StandardFieldKey } from "./metadata-standard.js";
import { ValueType } from "./filters.js";
import { buildSearchRegistry } from "./search-registry.js";
import type { MetadataSchema } from "./metadata-resolve.js";

function field(p: Partial<MetadataSchema[number]["fields"][number]> & { id: string; key: string }) {
  return {
    label: p.key, type: FieldType.Text, kind: FieldKind.Custom, builtinKey: null,
    enabled: true, suggests: true, options: [], ...p,
  };
}
const schema = (fields: any[]): MetadataSchema => [{ id: "g1", label: "G", fields }];

describe("buildSearchRegistry", () => {
  it("maps a custom text field to a metadata-relation def with string ops", () => {
    const reg = buildSearchRegistry(schema([field({ id: "f1", key: "film-stock", type: FieldType.Text })]));
    const def = reg.get("film-stock")!;
    expect(def.storage).toEqual({ kind: "metadata", fieldId: "f1" });
    expect(def.type).toBe(ValueType.string);
    expect(def.ops).toContain(RuleOp.contains);
    expect(def.ops).toContain(RuleOp.in_list);
    expect(def.ops).not.toContain(RuleOp.between);
  });

  it("gives a custom number field equality/in/exists but NOT range ops", () => {
    const reg = buildSearchRegistry(schema([field({ id: "f2", key: "frames", type: FieldType.Number })]));
    const def = reg.get("frames")!;
    expect(def.type).toBe(ValueType.number);
    expect(def.ops).toEqual([RuleOp.eq, RuleOp.in_list, RuleOp.exists, RuleOp.not_exists]);
  });

  it("maps a standard camera field to the cameraModel column with effective-value string ops", () => {
    const reg = buildSearchRegistry(schema([
      field({ id: "f3", key: "camera", type: FieldType.Text, kind: FieldKind.Standard, builtinKey: StandardFieldKey.Camera }),
    ]));
    const def = reg.get("camera")!;
    expect(def.storage).toEqual({ kind: "standard", column: "cameraModel", fieldId: "f3" });
    expect(def.type).toBe(ValueType.string);
    expect(def.ops).toContain(RuleOp.contains);
  });

  it("maps a standard iso field to a numeric column with range ops", () => {
    const reg = buildSearchRegistry(schema([
      field({ id: "f4", key: "iso", type: FieldType.Number, kind: FieldKind.Standard, builtinKey: StandardFieldKey.Iso }),
    ]));
    const def = reg.get("iso")!;
    expect(def.storage).toEqual({ kind: "standard", column: "iso", fieldId: "f4" });
    expect(def.type).toBe(ValueType.number);
    expect(def.ops).toContain(RuleOp.between);
  });

  it("skips disabled fields", () => {
    const reg = buildSearchRegistry(schema([field({ id: "f5", key: "hidden", enabled: false })]));
    expect(reg.has("hidden")).toBe(false);
  });
});
