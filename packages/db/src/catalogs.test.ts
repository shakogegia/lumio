import { describe, expect, it } from "vitest";
import { createCatalog, uniqueSlug } from "./catalogs.js";

function fakeDb(initial: Array<{ slug: string }> = []) {
  const rows = [...initial];
  return { catalog: {
    findUnique: async ({ where: { slug } }: { where: { slug: string } }) => rows.find((r) => r.slug === slug) ?? null,
    create: async ({ data }: { data: { name: string; slug: string; path: string } }) => { const row = { id: `cat_${rows.length + 1}`, uploadTemplate: "t", ...data }; rows.push(row); return row; },
  } };
}

describe("uniqueSlug", () => {
  it("returns the base slug when free", async () => { expect(await uniqueSlug("family", fakeDb() as never)).toBe("family"); });
  it("suffixes -2, -3 on collision", async () => { const db = fakeDb([{ slug: "family" }, { slug: "family-2" }]); expect(await uniqueSlug("family", db as never)).toBe("family-3"); });
});

describe("createCatalog", () => {
  it("derives a unique slug from the name", async () => { const db = fakeDb([{ slug: "trip" }]); const cat = await createCatalog({ name: "Trip", path: "/media/trip" }, db as never); expect(cat.slug).toBe("trip-2"); expect(cat.path).toBe("/media/trip"); });
});
