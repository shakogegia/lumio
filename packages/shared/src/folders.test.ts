import { describe, expect, it } from "vitest";
import {
  createFolderSchema,
  folderDeleteModeSchema,
  moveItemsSchema,
  renameFolderSchema,
} from "./folders.js";

describe("createFolderSchema", () => {
  it("accepts a name with no parent (top level)", () => {
    const r = createFolderSchema.parse({ name: "Europe" });
    expect(r.name).toBe("Europe");
    expect(r.parentId ?? null).toBeNull();
  });

  it("accepts a name with a parentId", () => {
    const r = createFolderSchema.parse({ name: "Italy", parentId: "f1" });
    expect(r.parentId).toBe("f1");
  });

  it("rejects an empty name", () => {
    expect(() => createFolderSchema.parse({ name: "" })).toThrow();
  });
});

describe("renameFolderSchema", () => {
  it("accepts a non-empty name", () => {
    expect(renameFolderSchema.parse({ name: "x" }).name).toBe("x");
  });
  it("rejects an empty name", () => {
    expect(() => renameFolderSchema.parse({ name: "" })).toThrow();
  });
});

describe("moveItemsSchema", () => {
  it("accepts folderIds with a null target (top level)", () => {
    const r = moveItemsSchema.parse({ folderIds: ["f1"], targetFolderId: null });
    expect(r.targetFolderId).toBeNull();
  });

  it("accepts albumIds with a string target", () => {
    const r = moveItemsSchema.parse({ albumIds: ["a1"], targetFolderId: "f2" });
    expect(r.albumIds).toEqual(["a1"]);
  });

  it("rejects when neither folderIds nor albumIds is provided", () => {
    expect(() => moveItemsSchema.parse({ targetFolderId: null })).toThrow();
  });

  it("rejects when both arrays are empty", () => {
    expect(() =>
      moveItemsSchema.parse({ folderIds: [], albumIds: [], targetFolderId: null }),
    ).toThrow();
  });
});

describe("folderDeleteModeSchema", () => {
  it("defaults to reparent when mode is omitted", () => {
    expect(folderDeleteModeSchema.parse({}).mode).toBe("reparent");
  });
  it("accepts cascade", () => {
    expect(folderDeleteModeSchema.parse({ mode: "cascade" }).mode).toBe("cascade");
  });
  it("rejects an unknown mode", () => {
    expect(() => folderDeleteModeSchema.parse({ mode: "nuke" })).toThrow();
  });
});
