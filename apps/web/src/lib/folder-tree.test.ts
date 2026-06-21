import { describe, expect, it } from "vitest";
import { collectDescendantFolderIds, folderBreadcrumbs } from "./folder-tree.js";

// Tree: root(null) -> europe -> italy -> {rome leaf}, europe -> france
const FOLDERS = [
  { id: "europe", parentId: null, name: "Europe" },
  { id: "italy", parentId: "europe", name: "Italy" },
  { id: "rome", parentId: "italy", name: "Rome" },
  { id: "france", parentId: "europe", name: "France" },
];

describe("collectDescendantFolderIds", () => {
  it("includes the root itself and every descendant", () => {
    const ids = collectDescendantFolderIds(FOLDERS, "europe").sort();
    expect(ids).toEqual(["europe", "france", "italy", "rome"]);
  });

  it("returns just the node for a leaf", () => {
    expect(collectDescendantFolderIds(FOLDERS, "rome")).toEqual(["rome"]);
  });

  it("returns just the node for an unknown id", () => {
    expect(collectDescendantFolderIds(FOLDERS, "ghost")).toEqual(["ghost"]);
  });
});

describe("folderBreadcrumbs", () => {
  it("returns the ancestor chain top-down, inclusive", () => {
    expect(folderBreadcrumbs(FOLDERS, "rome").map((f) => f.id)).toEqual([
      "europe",
      "italy",
      "rome",
    ]);
  });

  it("returns a single entry for a top-level folder", () => {
    expect(folderBreadcrumbs(FOLDERS, "europe").map((f) => f.id)).toEqual(["europe"]);
  });
});
