import { describe, expect, it } from "vitest";
import type { AlbumSummaryDTO } from "@lumio/shared";
import { partitionAlbums } from "./partition-albums";

function album(id: string, isSmart: boolean): AlbumSummaryDTO {
  return {
    id,
    name: id,
    isSmart,
    rules: null,
    folderId: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    photoCount: 0,
    coverPhotoId: null,
  };
}

describe("partitionAlbums", () => {
  it("splits regular and smart albums", () => {
    const { regular, smart } = partitionAlbums([
      album("a", false),
      album("s1", true),
      album("b", false),
      album("s2", true),
    ]);
    expect(regular.map((a) => a.id)).toEqual(["a", "b"]);
    expect(smart.map((a) => a.id)).toEqual(["s1", "s2"]);
  });

  it("returns empty groups for empty input", () => {
    expect(partitionAlbums([])).toEqual({ regular: [], smart: [] });
  });

  it("preserves input order within each group", () => {
    const { regular } = partitionAlbums([album("z", false), album("a", false)]);
    expect(regular.map((a) => a.id)).toEqual(["z", "a"]);
  });
});
