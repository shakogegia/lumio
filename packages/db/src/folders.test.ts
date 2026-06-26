import { describe, expect, it } from "vitest";
import {
  buildSearchRegistry,
  FieldKind,
  FieldType,
  MatchType,
  RuleOp,
  type MetadataSchema,
} from "@lumio/shared";
import { folderPhotoWhere } from "./folders.js";

const NOW = new Date("2026-06-21T00:00:00.000Z");

/** A catalog schema with one custom Choice field, matching what getCatalogSchema returns. */
const CHOICE_SCHEMA: MetadataSchema = [
  {
    id: "g1",
    label: "Equipment",
    fields: [
      {
        id: "fld_film_format",
        key: "film-format",
        label: "Film Format",
        type: FieldType.Choice,
        kind: FieldKind.Custom,
        builtinKey: null,
        enabled: true,
        suggests: false,
        options: ["35mm", "6×6"],
      },
    ],
  },
];

describe("folderPhotoWhere", () => {
  it("returns a never-match clause when there are no albums", () => {
    const where = folderPhotoWhere({ regularAlbumIds: [], smartAlbums: [] }, NOW);
    expect(where).toEqual({ id: { in: [] } });
  });

  it("ORs regular-album membership for regular-only input", () => {
    const where = folderPhotoWhere({ regularAlbumIds: ["a1", "a2"], smartAlbums: [] }, NOW);
    expect(where).toEqual({
      OR: [{ albums: { some: { albumId: { in: ["a1", "a2"] } } } }],
    });
  });

  it("ORs each smart-album predicate for smart-only input", () => {
    const where = folderPhotoWhere(
      {
        regularAlbumIds: [],
        smartAlbums: [
          { rules: { match: MatchType.all, rules: [{ field: "exif.cameraModel", op: RuleOp.eq, value: "X" }] } },
        ],
      },
      NOW,
    );
    expect(where).toEqual({
      OR: [{ AND: [{ exif: { path: ["cameraModel"], equals: "X" } }] }],
    });
  });

  it("resolves a custom-field smart-album rule via the per-catalog registry", () => {
    const registry = buildSearchRegistry(CHOICE_SCHEMA);
    const where = folderPhotoWhere(
      {
        regularAlbumIds: [],
        smartAlbums: [
          { rules: { match: MatchType.all, rules: [{ field: "film-format", op: RuleOp.in_list, value: ["35mm", "6×6"] }] } },
        ],
      },
      NOW,
      registry,
    );
    expect(where).toEqual({
      OR: [
        { AND: [{ metadataValues: { some: { fieldId: "fld_film_format", value: { in: ["35mm", "6×6"] } } } }] },
      ],
    });
  });

  it("combines regular membership and smart predicates", () => {
    const where = folderPhotoWhere(
      {
        regularAlbumIds: ["a1"],
        smartAlbums: [
          { rules: { match: MatchType.any, rules: [{ field: "takenAt", op: RuleOp.last_30_days }] } },
        ],
      },
      NOW,
    );
    expect(where).toEqual({
      OR: [
        { albums: { some: { albumId: { in: ["a1"] } } } },
        { OR: [{ takenAt: { gte: new Date("2026-05-22T00:00:00.000Z") } }] },
      ],
    });
  });
});
