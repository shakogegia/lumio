import { describe, expect, it } from "vitest";
import type { AlbumSummaryDTO, FolderDTO } from "@lumio/shared";
import { buildAlbumTree, buildFolderPickerRows } from "./library-tree-rows.js";

function folder(id: string, name: string, parentId: string | null = null): FolderDTO {
  return { id, name, parentId, createdAt: "", updatedAt: "" };
}
function album(
  id: string,
  name: string,
  folderId: string | null,
  isSmart = false,
): AlbumSummaryDTO {
  return {
    id,
    name,
    isSmart,
    rules: null,
    coverPhotoId: null,
    folderId,
    createdAt: "",
    updatedAt: "",
    photoCount: 0,
  };
}

// europe > italy ; europe > france (empty) ; top-level folder "empty"
const FOLDERS = [
  folder("europe", "Europe"),
  folder("italy", "Italy", "europe"),
  folder("france", "France", "europe"),
  folder("empty", "Empty"),
];
const ALBUMS = [
  album("top", "Top Album", null),
  album("rome", "Rome", "italy"),
  album("milan", "Milan", "italy"),
  album("smart", "Recent", null, true),
];

describe("buildAlbumTree", () => {
  it("excludes a given albumId, keeping a folder that still has another album", () => {
    const tree = buildAlbumTree(FOLDERS, ALBUMS, { excludeAlbumId: "rome" });
    const italy = tree.folders[0]?.folders[0];
    expect(italy?.id).toBe("italy");
    expect(italy?.albums.map((a) => a.id)).toEqual(["milan"]);
  });

  it("nests albums under their folders, pruning empty branches and smart albums", () => {
    const tree = buildAlbumTree(FOLDERS, ALBUMS);
    expect(tree.albums.map((a) => a.id)).toEqual(["top"]); // top-level album only
    expect(tree.folders.map((f) => f.id)).toEqual(["europe"]); // France/Empty pruned
    const europe = tree.folders[0];
    expect(europe.albums).toEqual([]); // Europe has no direct albums
    expect(europe.folders.map((f) => f.id)).toEqual(["italy"]); // France pruned (no albums)
    const italy = europe.folders[0];
    expect(italy.albums.map((a) => a.id)).toEqual(["milan", "rome"]); // sorted by name
    expect(italy.folders).toEqual([]);
  });

  it("keeps empty folders + smart albums when requested", () => {
    const tree = buildAlbumTree(FOLDERS, ALBUMS, { includeSmart: true, includeEmptyFolders: true });
    expect(tree.albums.map((a) => a.id).sort()).toEqual(["smart", "top"]);
    expect(tree.folders.map((f) => f.id)).toEqual(["empty", "europe"]);
  });
});

describe("buildFolderPickerRows", () => {
  it("lists every folder in tree order with depth", () => {
    const rows = buildFolderPickerRows(FOLDERS);
    expect(rows.map((r) => [r.id, r.depth])).toEqual([
      ["empty", 0],
      ["europe", 0],
      ["france", 1],
      ["italy", 1],
    ]);
    expect(rows.every((r) => !r.disabled)).toBe(true);
  });

  it("disables the excluded folder and all its descendants", () => {
    const rows = buildFolderPickerRows(FOLDERS, { excludeSubtreeOf: "europe" });
    const disabled = rows.filter((r) => r.disabled).map((r) => r.id).sort();
    expect(disabled).toEqual(["europe", "france", "italy"]);
    expect(rows.find((r) => r.id === "empty")?.disabled).toBe(false);
  });
});
