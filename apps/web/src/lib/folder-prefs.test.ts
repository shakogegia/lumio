import { describe, expect, it } from "vitest";
import { DEFAULT_FOLDER_PREFS, parseFolderPrefs, serializeFolderPrefs } from "./folder-prefs.js";

describe("parseFolderPrefs", () => {
  it("returns defaults for missing or garbage values", () => {
    expect(parseFolderPrefs(null)).toEqual(DEFAULT_FOLDER_PREFS);
    expect(parseFolderPrefs("not json")).toEqual(DEFAULT_FOLDER_PREFS);
    expect(parseFolderPrefs("123")).toEqual(DEFAULT_FOLDER_PREFS);
  });

  it("parses a valid URL-encoded cookie value", () => {
    const enc = encodeURIComponent(
      JSON.stringify({ view: "list", columns: 4, sortField: "date", sortDir: "desc" }),
    );
    expect(parseFolderPrefs(enc)).toEqual({
      view: "list",
      columns: 4,
      sort: { field: "date", dir: "desc" },
    });
  });

  it("clamps columns and falls back per-field for bad values", () => {
    const v = parseFolderPrefs(
      JSON.stringify({ view: "weird", columns: 999, sortField: "x", sortDir: "y" }),
    );
    expect(v.view).toBe("grid");
    expect(v.columns).toBe(12); // COLUMNS_MAX
    expect(v.sort).toEqual({ field: "name", dir: "asc" });
  });

  it("round-trips with serializeFolderPrefs", () => {
    const prefs = { view: "list", columns: 8, sort: { field: "date", dir: "asc" } } as const;
    expect(parseFolderPrefs(serializeFolderPrefs(prefs))).toEqual(prefs);
  });
});
