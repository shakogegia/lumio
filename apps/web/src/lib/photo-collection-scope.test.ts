import { describe, expect, it } from "vitest";
import { collectionForScope } from "./photo-collection-scope.js";

describe("collectionForScope", () => {
  it("library: /api/photos with sort, base /photos", () => {
    const c = collectionForScope({ kind: "library", sort: "taken-desc" });
    expect(c.endpoint).toBe("/api/photos");
    expect(c.params.get("sort")).toBe("taken-desc");
    expect(c.baseUrl).toBe("/photos");
    expect(c.urlForId("p1")).toBe("/photo/p1"); // default sort omitted in URL
  });

  it("album: scoped endpoint + ?album in the URL", () => {
    const c = collectionForScope({ kind: "album", albumId: "alb1", sort: "imported-asc" });
    expect(c.endpoint).toBe("/api/albums/alb1/photos");
    expect(c.params.get("sort")).toBe("imported-asc");
    expect(c.baseUrl).toBe("/albums/alb1");
    expect(c.urlForId("p1")).toBe("/photo/p1?album=alb1&sort=imported-asc");
  });

  it("search: /api/search with repeated album + q, base /search", () => {
    const c = collectionForScope({ kind: "search", albums: ["a", "b"], q: "cat", sort: "taken-desc" });
    expect(c.endpoint).toBe("/api/search");
    expect(c.params.getAll("album")).toEqual(["a", "b"]);
    expect(c.params.get("q")).toBe("cat");
    expect(c.baseUrl).toBe("/search");
    expect(c.urlForId("p1")).toBe("/photo/p1?s=1&album=a&album=b&q=cat");
  });
});
