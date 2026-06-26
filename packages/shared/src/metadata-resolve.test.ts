import { describe, expect, it } from "vitest";
import { FieldType, FieldKind, MetadataValueSource } from "./enums.js";
import { StandardFieldKey } from "./metadata-standard.js";
import { resolvePhotoMetadata, type MetadataSchema } from "./metadata-resolve.js";

const schema: MetadataSchema = [
  {
    id: "g1",
    label: "Camera & exposure",
    fields: [
      { id: "f-cam", key: "camera", label: "Camera", type: FieldType.Text, kind: FieldKind.Standard, builtinKey: StandardFieldKey.Camera, enabled: true, suggests: false, options: [] },
      { id: "f-iso", key: "iso", label: "ISO", type: FieldType.Number, kind: FieldKind.Standard, builtinKey: StandardFieldKey.Iso, enabled: false, suggests: false, options: [] },
    ],
  },
  {
    id: "g2",
    label: "Film",
    fields: [
      { id: "f-stock", key: "film-stock", label: "Film stock", type: FieldType.Text, kind: FieldKind.Custom, builtinKey: null, enabled: true, suggests: true, options: [] },
    ],
  },
];

describe("resolvePhotoMetadata", () => {
  it("fills standard fields from exif and marks the source", () => {
    const out = resolvePhotoMetadata(schema, new Map(), { Make: "SONY", Model: "ILCE-6400" });
    expect(out).toHaveLength(2);
    const cam = out[0]!.fields[0]!;
    expect(cam.value).toBe("SONY ILCE-6400");
    expect(cam.source).toBe(MetadataValueSource.Exif);
  });

  it("omits disabled fields", () => {
    const out = resolvePhotoMetadata(schema, new Map(), {});
    expect(out[0]!.fields.map((f) => f.key)).toEqual(["camera"]); // iso is disabled
  });

  it("a stored value overrides the exif-derived standard value", () => {
    const out = resolvePhotoMetadata(schema, new Map([["f-cam", "Bronica RF645"]]), { Make: "SONY", Model: "ILCE-6400" });
    expect(out[0]!.fields[0]!.value).toBe("Bronica RF645");
    expect(out[0]!.fields[0]!.source).toBe(MetadataValueSource.User);
  });

  it("custom fields come from stored values; empty when absent", () => {
    const filled = resolvePhotoMetadata(schema, new Map([["f-stock", "Kodak Portra 400"]]), {});
    expect(filled[1]!.fields[0]).toMatchObject({ value: "Kodak Portra 400", source: MetadataValueSource.User });
    const empty = resolvePhotoMetadata(schema, new Map(), {});
    expect(empty[1]!.fields[0]).toMatchObject({ value: null, source: MetadataValueSource.Empty });
  });
});
