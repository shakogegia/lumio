import { describe, expect, it } from "vitest";
import { collectionForScope } from "./photo-collection-scope.js";

describe("collectionForScope", () => {
  it("library: slug-scoped /photos with sort, base /photos", () => {
    const c = collectionForScope("fam", { kind: "library", sort: "imported-desc" });
    expect(c.endpoint).toBe("/api/c/fam/photos");
    expect(c.params.get("sort")).toBe("imported-desc");
    expect(c.baseUrl).toBe("/photos");
    expect(c.urlForId("p1")).toBe("/photo/p1"); // default sort omitted in URL
  });

  it("album: slug-scoped endpoint + ?album in the URL", () => {
    const c = collectionForScope("fam", { kind: "album", albumId: "alb1", sort: "imported-asc" });
    expect(c.endpoint).toBe("/api/c/fam/albums/alb1/photos");
    expect(c.params.get("sort")).toBe("imported-asc");
    expect(c.baseUrl).toBe("/albums/alb1");
    expect(c.urlForId("p1")).toBe("/photo/p1?album=alb1&sort=imported-asc");
  });

  it("search: slug-scoped /search with repeated album + q, base /search", () => {
    const c = collectionForScope("fam", { kind: "search", albums: ["a", "b"], q: "cat", sort: "imported-desc" });
    expect(c.endpoint).toBe("/api/c/fam/search");
    expect(c.params.getAll("album")).toEqual(["a", "b"]);
    expect(c.params.get("q")).toBe("cat");
    expect(c.baseUrl).toBe("/search");
    expect(c.urlForId("p1")).toBe("/photo/p1?s=1&album=a&album=b&q=cat");
  });
});
