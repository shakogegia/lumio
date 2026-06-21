import { describe, expect, it } from "vitest";
import { PHOTO_ORDER, photoOrderBy } from "./photo-order";

describe("photoOrderBy", () => {
  it("defaults to taken-date newest first", () => {
    expect(photoOrderBy()).toEqual([{ sortDate: "desc" }, { id: "desc" }]);
    expect(photoOrderBy("taken-desc")).toEqual([{ sortDate: "desc" }, { id: "desc" }]);
  });

  it("orders by sortDate ascending with a matching id tiebreaker", () => {
    expect(photoOrderBy("taken-asc")).toEqual([{ sortDate: "asc" }, { id: "asc" }]);
  });

  it("orders by createdAt descending for imported-desc", () => {
    expect(photoOrderBy("imported-desc")).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
  });

  it("orders by createdAt ascending for imported-asc", () => {
    expect(photoOrderBy("imported-asc")).toEqual([{ createdAt: "asc" }, { id: "asc" }]);
  });

  it("orders by fileCreatedAt descending for file-created-desc", () => {
    expect(photoOrderBy("file-created-desc")).toEqual([{ fileCreatedAt: "desc" }, { id: "desc" }]);
  });

  it("orders by fileCreatedAt ascending for file-created-asc", () => {
    expect(photoOrderBy("file-created-asc")).toEqual([{ fileCreatedAt: "asc" }, { id: "asc" }]);
  });

  it("PHOTO_ORDER equals the default order", () => {
    expect(PHOTO_ORDER).toEqual([{ sortDate: "desc" }, { id: "desc" }]);
  });
});
