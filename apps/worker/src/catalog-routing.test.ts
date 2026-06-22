import { describe, expect, it } from "vitest";
import { catalogForPath } from "./catalog-routing.js";

const cats = [
  { id: "a", path: "/media/family" },
  { id: "b", path: "/media/family/2024" },
  { id: "c", path: "/media/trips" },
];

describe("catalogForPath", () => {
  it("matches the catalog whose root contains the file", () => {
    expect(catalogForPath(cats, "/media/trips/a.jpg")?.id).toBe("c");
  });

  it("prefers the longest matching root", () => {
    expect(catalogForPath(cats, "/media/family/2024/a.jpg")?.id).toBe("b");
    expect(catalogForPath(cats, "/media/family/old/a.jpg")?.id).toBe("a");
  });

  it("returns undefined when no root matches", () => {
    expect(catalogForPath(cats, "/etc/passwd")).toBeUndefined();
  });
});
