import { describe, expect, it } from "vitest";
import { catalogCacheDirs, displayPath, editedDisplayPath, thumbnailPath } from "./paths.js";

describe("catalog cache paths", () => {
  const root = "/cache";

  it("catalogCacheDirs nests the three rendition dirs under <root>/<catalogId>", () => {
    expect(catalogCacheDirs(root, "cat1")).toEqual({
      thumbnailsDir: "/cache/cat1/thumbnails",
      displaysDir: "/cache/cat1/displays",
      editedDisplaysDir: "/cache/cat1/displays-edited",
    });
  });

  it("the file-path helpers point at <dir>/<id>.webp", () => {
    expect(thumbnailPath(root, "cat1", "p1")).toBe("/cache/cat1/thumbnails/p1.webp");
    expect(displayPath(root, "cat1", "p1")).toBe("/cache/cat1/displays/p1.webp");
    expect(editedDisplayPath(root, "cat1", "p1")).toBe("/cache/cat1/displays-edited/p1.webp");
  });
});
