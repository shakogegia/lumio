import { describe, expect, it } from "vitest";
import { catalogCacheDirs, resolveConcurrency, thumbnailPath } from "./config.js";

describe("resolveConcurrency", () => {
  it("defaults to half the cores so a bulk import leaves CPU headroom", () => {
    expect(resolveConcurrency(undefined, 12)).toBe(6);
    expect(resolveConcurrency(undefined, 4)).toBe(2);
  });

  it("never goes below 1 (single-core box)", () => {
    expect(resolveConcurrency(undefined, 1)).toBe(1);
  });

  it("honours an explicit positive override", () => {
    expect(resolveConcurrency("8", 12)).toBe(8);
    expect(resolveConcurrency("1", 4)).toBe(1);
  });

  it("ignores empty / zero / negative / non-numeric values and falls back to the default", () => {
    expect(resolveConcurrency("", 12)).toBe(6);
    expect(resolveConcurrency("0", 12)).toBe(6);
    expect(resolveConcurrency("-5", 12)).toBe(6);
    expect(resolveConcurrency("abc", 12)).toBe(6);
  });

  it("floors fractional overrides", () => {
    expect(resolveConcurrency("3.9", 12)).toBe(3);
  });
});

describe("per-catalog cache paths", () => {
  it("nests cache under the catalog id", () => {
    const dirs = catalogCacheDirs("cat1");
    expect(dirs.thumbnailsDir.endsWith("/cat1/thumbnails")).toBe(true);
    expect(dirs.displaysDir.endsWith("/cat1/displays")).toBe(true);
    expect(dirs.editedDisplaysDir.endsWith("/cat1/displays-edited")).toBe(true);
  });

  it("thumbnailPath includes catalog id and photo id", () => {
    expect(thumbnailPath("cat1", "p9").endsWith("/cat1/thumbnails/p9.webp")).toBe(true);
  });
});
