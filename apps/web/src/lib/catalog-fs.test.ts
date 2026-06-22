import { describe, expect, it } from "vitest";
import {
  buildCatalogListing,
  catalogBreadcrumbs,
  folderCountLabel,
  joinRel,
  relDirname,
  sortFolderItems,
} from "./catalog-fs.js";

describe("joinRel", () => {
  it("joins under a parent and handles the root", () => {
    expect(joinRel("", "2024")).toBe("2024");
    expect(joinRel("2024", "trip")).toBe("2024/trip");
  });
});

describe("catalogBreadcrumbs", () => {
  it("always starts with the Library root crumb", () => {
    expect(catalogBreadcrumbs("")).toEqual([{ name: "Library", rel: "" }]);
  });
  it("accumulates rel paths per segment", () => {
    expect(catalogBreadcrumbs("2024/trip")).toEqual([
      { name: "Library", rel: "" },
      { name: "2024", rel: "2024" },
      { name: "trip", rel: "2024/trip" },
    ]);
  });
});

describe("buildCatalogListing", () => {
  it("splits dirs/files, sorts by name, tags images + photoIds + subfolder counts", () => {
    const photoIdByRel = new Map([["2024/a.jpg", "p1"]]);
    const dirCounts = new Map([["2024/sub", { folderCount: 1, fileCount: 4 }]]);
    const listing = buildCatalogListing(
      "2024",
      [
        { name: "b.txt", isDirectory: false, size: 10, mtimeMs: 200 },
        { name: "a.jpg", isDirectory: false, size: 20, mtimeMs: 100 },
        { name: "sub", isDirectory: true, size: 0, mtimeMs: 300 },
      ],
      photoIdByRel,
      dirCounts,
    );
    expect(listing.dirs).toEqual([
      { name: "sub", rel: "2024/sub", mtimeMs: 300, folderCount: 1, fileCount: 4 },
    ]);
    expect(listing.files).toEqual([
      { name: "a.jpg", rel: "2024/a.jpg", size: 20, mtimeMs: 100, isImage: true, photoId: "p1" },
      { name: "b.txt", rel: "2024/b.txt", size: 10, mtimeMs: 200, isImage: false, photoId: null },
    ]);
  });

  it("defaults subfolder counts to 0 when not provided", () => {
    const listing = buildCatalogListing(
      "",
      [{ name: "x", isDirectory: true, size: 0, mtimeMs: 0 }],
      new Map(),
    );
    expect(listing.dirs[0]).toMatchObject({ folderCount: 0, fileCount: 0 });
  });
});

describe("sortFolderItems", () => {
  const items = [
    { name: "b", mtimeMs: 300 },
    { name: "a", mtimeMs: 100 },
    { name: "c", mtimeMs: 200 },
  ];

  it("sorts by name ascending and descending", () => {
    expect(sortFolderItems(items, { field: "name", dir: "asc" }).map((i) => i.name)).toEqual([
      "a",
      "b",
      "c",
    ]);
    expect(sortFolderItems(items, { field: "name", dir: "desc" }).map((i) => i.name)).toEqual([
      "c",
      "b",
      "a",
    ]);
  });

  it("sorts by date ascending and descending", () => {
    expect(sortFolderItems(items, { field: "date", dir: "asc" }).map((i) => i.name)).toEqual([
      "a",
      "c",
      "b",
    ]);
    expect(sortFolderItems(items, { field: "date", dir: "desc" }).map((i) => i.name)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  it("returns a new array without mutating the input", () => {
    const before = [...items];
    sortFolderItems(items, { field: "name", dir: "desc" });
    expect(items).toEqual(before);
  });
});

describe("relDirname", () => {
  it("returns the parent path", () => {
    expect(relDirname("2024/trip/a.jpg")).toBe("2024/trip");
    expect(relDirname("2024")).toBe("");
    expect(relDirname("")).toBe("");
  });
});

describe("folderCountLabel", () => {
  it("pluralizes and joins both parts", () => {
    expect(folderCountLabel(2, 3)).toBe("2 folders, 3 files");
    expect(folderCountLabel(1, 1)).toBe("1 folder, 1 file");
  });
  it("omits zero parts and shows Empty when the folder has neither", () => {
    expect(folderCountLabel(0, 5)).toBe("5 files");
    expect(folderCountLabel(3, 0)).toBe("3 folders");
    expect(folderCountLabel(0, 0)).toBe("Empty");
  });
});
