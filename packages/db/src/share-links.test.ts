import { describe, expect, it, vi } from "vitest";
import {
  findShareLinkByToken,
  listShareLinksForCatalog,
  deleteShareLink,
  shareLinkPhotoExists,
  shareLinkPhotoWhere,
} from "./share-links.js";

describe("findShareLinkByToken", () => {
  it("looks up by unique token", async () => {
    const row = { id: "s1", token: "tok", catalogId: "c1" };
    const findUnique = vi.fn().mockResolvedValue(row);
    const db = { shareLink: { findUnique } };
    expect(await findShareLinkByToken("tok", db as never)).toBe(row);
    expect(findUnique).toHaveBeenCalledWith({ where: { token: "tok" } });
  });
});

describe("listShareLinksForCatalog", () => {
  it("lists a catalog's links newest-first", async () => {
    const rows = [{ id: "s1" }, { id: "s2" }];
    const findMany = vi.fn().mockResolvedValue(rows);
    const db = { shareLink: { findMany } };
    expect(await listShareLinksForCatalog("c1", db as never)).toBe(rows);
    expect(findMany).toHaveBeenCalledWith({ where: { catalogId: "c1" }, orderBy: { createdAt: "desc" } });
  });
});

describe("deleteShareLink", () => {
  it("scopes the delete to the catalog and reports the count", async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 1 });
    const db = { shareLink: { deleteMany } };
    expect(await deleteShareLink("c1", "s1", db as never)).toBe(1);
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: "s1", catalogId: "c1" } });
  });
});

describe("shareLinkPhotoExists", () => {
  it("returns true when a membership row is found", async () => {
    const db = { shareLinkPhoto: { findUnique: async () => ({ shareLinkId: "s1", photoId: "p1" }) } };
    expect(await shareLinkPhotoExists("s1", "p1", db as never)).toBe(true);
  });
  it("returns false when none", async () => {
    const db = { shareLinkPhoto: { findUnique: async () => null } };
    expect(await shareLinkPhotoExists("s1", "p1", db as never)).toBe(false);
  });
});

describe("shareLinkPhotoWhere", () => {
  it("builds the membership relation filter", () => {
    expect(shareLinkPhotoWhere("s1")).toEqual({ shareLinks: { some: { shareLinkId: "s1" } } });
  });
});
