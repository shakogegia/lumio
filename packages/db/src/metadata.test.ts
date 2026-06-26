import { describe, expect, it, vi } from "vitest";
import { FieldKind, FieldType, getPreset } from "@lumio/shared";
import {
  getCatalogSchema,
  applyMetadataPreset,
  clearCatalogSchema,
  upsertPhotoMetadataValue,
  getPhotoMetadataValues,
  suggestFieldValues,
  createMetadataField,
  createMetadataGroup,
  updateMetadataField,
  deleteMetadataField,
  reorderMetadataField,
  reorderMetadataGroup,
  bulkSetPhotoMetadataValues,
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

describe("clearCatalogSchema", () => {
  it("deletes a catalog's fields then groups inside a transaction", async () => {
    const order: string[] = [];
    const db = {
      $transaction: async (fn: (tx: any) => Promise<unknown>) =>
        fn({
          metadataField: { deleteMany: async () => { order.push("fields"); return { count: 3 }; } },
          metadataGroup: { deleteMany: async () => { order.push("groups"); return { count: 2 }; } },
        }),
    } as never;
    await clearCatalogSchema("cat1", db);
    expect(order).toEqual(["fields", "groups"]);
  });
});

describe("createMetadataField", () => {
  it("creates a custom field at the end of its group with a unique slug key", async () => {
    const created: any[] = [];
    const db = {
      metadataField: {
        findMany: async ({ select }: any) =>
          select?.key
            ? [{ key: "film-stock" }, { key: "developer" }]
            : [{ position: "a0" }, { position: "a1" }],
        create: async ({ data }: any) => { created.push(data); return { id: "f9", ...data }; },
      },
    } as never;
    const row = await createMetadataField("cat1", "g1", "Film Stock", "text", [], db);
    expect(row.key).toBe("film-stock-2"); // collides with existing "film-stock"
    expect(created[0]).toMatchObject({ catalogId: "cat1", groupId: "g1", kind: "custom", label: "Film Stock", type: "text" });
    expect(created[0].position > "a1").toBe(true); // appended after last
  });
});

describe("createMetadataGroup", () => {
  it("creates a group appended after the last position", async () => {
    let made: any = null;
    const db = {
      metadataGroup: {
        findMany: async () => [{ position: "a0" }],
        create: async ({ data }: any) => { made = data; return { id: "g9", ...data }; },
      },
    } as never;
    await createMetadataGroup("cat1", "Process", db);
    expect(made).toMatchObject({ catalogId: "cat1", label: "Process" });
    expect(made.position > "a0").toBe(true);
  });
});

describe("updateMetadataField / deleteMetadataField", () => {
  it("updates only the given fields", async () => {
    let arg: any = null;
    const db = { metadataField: { update: async (a: any) => { arg = a; return {}; } } } as never;
    await updateMetadataField("f1", { label: "Stock", enabled: false }, db);
    expect(arg).toEqual({ where: { id: "f1" }, data: { label: "Stock", enabled: false } });
  });
  it("allows updating options", async () => {
    let arg: any = null;
    const db = { metadataField: { update: async (a: any) => { arg = a; return {}; } } } as never;
    await updateMetadataField("f1", { options: ["35mm", "6×6"] }, db);
    expect(arg).toEqual({ where: { id: "f1" }, data: { options: ["35mm", "6×6"] } });
  });
  it("deletes by id", async () => {
    let arg: any = null;
    const db = { metadataField: { delete: async (a: any) => { arg = a; return {}; } } } as never;
    await deleteMetadataField("f1", db);
    expect(arg).toEqual({ where: { id: "f1" } });
  });
});

describe("reorderMetadataField", () => {
  it("loads the group's ordered fields and persists position updates", async () => {
    const updated: Array<{ id: string; position: string }> = [];
    const db = {
      metadataField: {
        findMany: async () => [
          { id: "a", position: "a0" },
          { id: "b", position: "a1" },
          { id: "c", position: "a2" },
        ],
        update: async ({ where, data }: any) => { updated.push({ id: where.id, position: data.position }); return {}; },
      },
      $transaction: async (fn: (tx: any) => Promise<unknown>) =>
        fn({ metadataField: { update: async (a: any) => { updated.push({ id: a.where.id, position: a.data.position }); return {}; } } }),
    } as never;
    // move "c" to the front (afterId null)
    await reorderMetadataField("g1", "c", null, db);
    expect(updated.some((u) => u.id === "c")).toBe(true); // the moved row got a new key
  });
});

describe("bulkSetPhotoMetadataValues", () => {
  it("upserts each non-empty value for every photo, skipping blank values", async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const create = vi.fn().mockResolvedValue({});
    const db = {
      $transaction: async (fn: (tx: any) => Promise<unknown>) =>
        fn({ photoMetadataValue: { updateMany, create } }),
    } as never;
    await bulkSetPhotoMetadataValues(
      ["p1", "p2"],
      [
        { fieldId: "f1", value: "Kodak Portra" },
        { fieldId: "f2", value: "  " }, // blank — must be skipped
        { fieldId: "f3", value: "120" },
      ],
      db,
    );
    // blank "f2" is filtered: only f1 and f3 per photo → 4 upsert attempts
    expect(updateMany).toHaveBeenCalledTimes(4);
    expect(create).toHaveBeenCalledTimes(4); // count was 0 each time → create called
    // ensure blank was never attempted
    expect(updateMany).not.toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ fieldId: "f2" }) }));
  });

  it("is a no-op when no photos or no non-empty values are provided", async () => {
    const $transaction = vi.fn();
    const db = { $transaction } as never;
    await bulkSetPhotoMetadataValues([], [{ fieldId: "f1", value: "x" }], db);
    await bulkSetPhotoMetadataValues(["p1"], [], db);
    await bulkSetPhotoMetadataValues(["p1"], [{ fieldId: "f1", value: "   " }], db);
    expect($transaction).not.toHaveBeenCalled();
  });
});

describe("reorderMetadataGroup", () => {
  it("reorders groups within a catalog", async () => {
    const updated: string[] = [];
    const db = {
      metadataGroup: { findMany: async () => [{ id: "g1", position: "a0" }, { id: "g2", position: "a1" }] },
      $transaction: async (fn: (tx: any) => Promise<unknown>) =>
        fn({ metadataGroup: { update: async (a: any) => { updated.push(a.where.id); return {}; } } }),
    } as never;
    await reorderMetadataGroup("cat1", "g2", null, db); // g2 to front
    expect(updated).toContain("g2");
  });
});
