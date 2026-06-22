import { describe, expect, it } from "vitest";
import manifest from "./manifest.js";

describe("manifest", () => {
  it("is an installable standalone PWA starting at the catalog-resolving root", () => {
    const m = manifest();
    expect(m.name).toBe("Lumio");
    expect(m.short_name).toBe("Lumio");
    expect(m.description).toBe("Your photo library.");
    expect(m.display).toBe("standalone");
    expect(m.start_url).toBe("/");
    expect(m.scope).toBe("/");
    expect(m.background_color).toBe("#000000");
    expect(m.theme_color).toBe("#000000");
  });

  it("declares 192 and 512 icons plus a maskable variant", () => {
    const icons = manifest().icons ?? [];
    expect(icons.some((i) => i.sizes === "192x192" && i.purpose === "any")).toBe(true);
    expect(icons.some((i) => i.sizes === "512x512" && i.purpose === "any")).toBe(true);
    expect(icons.some((i) => i.purpose === "maskable")).toBe(true);
    // Every declared icon must live under /icons/.
    expect(icons.every((i) => typeof i.src === "string" && i.src.startsWith("/icons/"))).toBe(true);
  });
});
