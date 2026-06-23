import { describe, expect, it } from "vitest";
import { catalogBreadcrumbs, joinRel } from "./catalog-fs.js";

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
