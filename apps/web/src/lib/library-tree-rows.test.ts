import { describe, expect, it } from "vitest";
import type { AlbumSummaryDTO, FolderDTO } from "@lumio/shared";
import { buildAlbumPickerRows, buildFolderPickerRows } from "./library-tree-rows.js";

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

describe("buildAlbumPickerRows", () => {
  it("lists top-level albums first, then folders with albums nested + indented", () => {
    const rows = buildAlbumPickerRows(FOLDERS, ALBUMS);
    expect(rows).toEqual([
      { kind: "album", album: ALBUMS[0], depth: 0 }, // Top Album
      { kind: "folder", id: "europe", name: "Europe", depth: 0 },
      { kind: "folder", id: "italy", name: "Italy", depth: 1 },
      { kind: "album", album: ALBUMS.find((a) => a.id === "milan"), depth: 2 },
      { kind: "album", album: ALBUMS.find((a) => a.id === "rome"), depth: 2 },
    ]);
  });

  it("omits smart albums and folders with no pickable album in their subtree", () => {
    const rows = buildAlbumPickerRows(FOLDERS, ALBUMS);
    // "France" and "Empty" have no albums → not present; smart album not present.
    expect(rows.some((r) => r.kind === "folder" && r.id === "france")).toBe(false);
    expect(rows.some((r) => r.kind === "folder" && r.id === "empty")).toBe(false);
    expect(rows.some((r) => r.kind === "album" && r.album.id === "smart")).toBe(false);
  });

  it("includes smart albums and empty folders when requested (sidebar nav tree)", () => {
    const rows = buildAlbumPickerRows(FOLDERS, ALBUMS, {
      includeSmart: true,
      includeEmptyFolders: true,
    });
    expect(rows.some((r) => r.kind === "album" && r.album.id === "smart")).toBe(true);
    expect(rows.some((r) => r.kind === "folder" && r.id === "france")).toBe(true);
    expect(rows.some((r) => r.kind === "folder" && r.id === "empty")).toBe(true);
  });

  it("excludes a given albumId", () => {
    const rows = buildAlbumPickerRows(FOLDERS, ALBUMS, { excludeAlbumId: "rome" });
    expect(rows.some((r) => r.kind === "album" && r.album.id === "rome")).toBe(false);
    // Italy still shows because Milan remains.
    expect(rows.some((r) => r.kind === "folder" && r.id === "italy")).toBe(true);
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
