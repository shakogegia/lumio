import { describe, expect, it } from "vitest";
import { distinctExtensions } from "./extensions.js";

describe("distinctExtensions", () => {
  it("queries distinct non-empty extensions for LIVE photos, sorted, and maps to strings", async () => {
    const calls: unknown[] = [];
    const db = {
      photo: {
        findMany: async (args: unknown) => {
          calls.push(args);
          return [{ extension: "cr2" }, { extension: "jpg" }];
        },
      },
    };
    const result = await distinctExtensions("cat1", db as never);
    expect(result).toEqual(["cr2", "jpg"]);
    expect(calls[0]).toEqual({
      where: { catalogId: "cat1", trashedAt: null, extension: { not: "" } },
      select: { extension: true },
      distinct: ["extension"],
      orderBy: { extension: "asc" },
    });
  });
});
