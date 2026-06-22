import { describe, expect, it } from "vitest";
import { parseFolderSort, serializeFolderSort } from "./use-folder-sort.js";

describe("parseFolderSort", () => {
  it("parses a valid field:dir pair", () => {
    expect(parseFolderSort("date:desc")).toEqual({ field: "date", dir: "desc" });
    expect(parseFolderSort("name:asc")).toEqual({ field: "name", dir: "asc" });
  });
  it("defaults to name/asc for missing or invalid input", () => {
    expect(parseFolderSort(null)).toEqual({ field: "name", dir: "asc" });
    expect(parseFolderSort("")).toEqual({ field: "name", dir: "asc" });
    expect(parseFolderSort("bogus")).toEqual({ field: "name", dir: "asc" });
    expect(parseFolderSort("size:up")).toEqual({ field: "name", dir: "asc" });
  });
});

describe("serializeFolderSort", () => {
  it("round-trips with parseFolderSort", () => {
    expect(serializeFolderSort({ field: "date", dir: "asc" })).toBe("date:asc");
    expect(parseFolderSort(serializeFolderSort({ field: "date", dir: "asc" }))).toEqual({
      field: "date",
      dir: "asc",
    });
  });
});
