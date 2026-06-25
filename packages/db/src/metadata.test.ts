import { describe, expect, it, vi } from "vitest";
import { FieldKind, FieldType, getPreset } from "@lumio/shared";
import {
  getCatalogSchema,
  applyMetadataPreset,
  upsertPhotoMetadataValue,
  getPhotoMetadataValues,
  suggestFieldValues,
} from "./metadata.js";

describe("getCatalogSchema", () => {
  it("groups ordered fields under their groups, in position order", async () => {
    const db = {
      metadataGroup: {
        findMany: async () => [
          { id: "g1", label: "Film", position: "a0" },
          { id: "g2", label: "Process", position: "a1" },
        ],
      },
      metadataField: {
        findMany: async () => [
          { id: "f1", groupId: "g1", key: "film-stock", label: "Film stock", type: "text", kind: "custom", builtinKey: null, enabled: true, suggests: true, position: "a0" },
          { id: "f2", groupId: "g2", key: "developer", label: "Developer", type: "text", kind: "custom", builtinKey: null, enabled: true, suggests: true, position: "a0" },
        ],
      },
    } as never;
    const schema = await getCatalogSchema("cat1", db);
    expect(schema.map((g) => g.label)).toEqual(["Film", "Process"]);
    expect(schema[0]!.fields[0]!.key).toBe("film-stock");
    expect(schema[1]!.fields[0]!.key).toBe("developer");
  });
});

describe("applyMetadataPreset", () => {
  it("creates one group per preset group and one field per field, with ordered positions", async () => {
    const created: { groups: any[]; fields: any[] } = { groups: [], fields: [] };
    let gid = 0;
    const db = {
      $transaction: async (fn: (tx: any) => Promise<unknown>) =>
        fn({
          metadataGroup: { create: async ({ data }: any) => { const row = { id: `g${++gid}`, ...data }; created.groups.push(row); return row; } },
          metadataField: { create: async ({ data }: any) => { created.fields.push(data); return data; } },
        }),
    } as never;

    await applyMetadataPreset("cat1", getPreset("nlp")!, db);

    expect(created.groups).toHaveLength(4);
    expect(created.fields).toHaveLength(27);
    // positions sort in creation order under byte collation
    const gPos = created.groups.map((g) => g.position);
    expect([...gPos].sort()).toEqual(gPos);
    // every field carries the catalog + its group + kind
    expect(created.fields.every((f) => f.catalogId === "cat1")).toBe(true);
    const stock = created.fields.find((f) => f.key === "film-stock");
    expect(stock).toMatchObject({ label: "Film Stock", type: FieldType.Text, kind: FieldKind.Custom });
  });
});

describe("upsertPhotoMetadataValue", () => {
  it("updates an existing row, else creates it (NULL-safe, like setFeature)", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const create = vi.fn().mockResolvedValue({});
    const db = { photoMetadataValue: { updateMany, create } } as never;
    await upsertPhotoMetadataValue("p1", "f1", "Kodak Portra 400", db);
    expect(updateMany).toHaveBeenCalledWith({ where: { photoId: "p1", fieldId: "f1" }, data: { value: "Kodak Portra 400" } });
    expect(create).toHaveBeenCalledWith({ data: { photoId: "p1", fieldId: "f1", value: "Kodak Portra 400" } });
  });

  it("does not create when an update hit a row", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const create = vi.fn();
    const db = { photoMetadataValue: { updateMany, create } } as never;
    await upsertPhotoMetadataValue("p1", "f1", "x", db);
    expect(create).not.toHaveBeenCalled();
  });

  it("deletes the row when value is empty", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const db = { photoMetadataValue: { deleteMany } } as never;
    await upsertPhotoMetadataValue("p1", "f1", "", db);
    expect(deleteMany).toHaveBeenCalledWith({ where: { photoId: "p1", fieldId: "f1" } });
  });
});

describe("getPhotoMetadataValues", () => {
  it("returns a fieldId→value map", async () => {
    const db = { photoMetadataValue: { findMany: async () => [{ fieldId: "f1", value: "a" }, { fieldId: "f2", value: "b" }] } } as never;
    const map = await getPhotoMetadataValues("p1", db);
    expect(map.get("f1")).toBe("a");
    expect(map.get("f2")).toBe("b");
  });
});

describe("suggestFieldValues", () => {
  it("returns distinct prior values for a field, most-used first", async () => {
    const groupBy = vi.fn().mockResolvedValue([
      { value: "Kodak Portra 400", _count: { _all: 12 } },
      { value: "Kodak Gold 200", _count: { _all: 3 } },
    ]);
    const db = { photoMetadataValue: { groupBy } } as never;
    const out = await suggestFieldValues("f1", "kod", db);
    expect(out).toEqual(["Kodak Portra 400", "Kodak Gold 200"]);
    expect(groupBy).toHaveBeenCalled();
  });
});
