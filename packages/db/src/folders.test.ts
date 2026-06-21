import { describe, expect, it } from "vitest";
import { MatchType, RuleOp } from "@lumio/shared";
import { folderPhotoWhere } from "./folders.js";

const NOW = new Date("2026-06-21T00:00:00.000Z");

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
