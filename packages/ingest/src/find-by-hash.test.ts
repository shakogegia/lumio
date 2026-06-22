import { describe, expect, it } from "vitest";
import { findPhotoByHash } from "./find-by-hash.js";

function fakeDb(result: { id: string } | null) {
  const calls: unknown[] = [];
  return {
    calls,
    photo: {
      findFirst: async (args: unknown) => {
        calls.push(args);
        return result;
      },
    },
  };
}

describe("findPhotoByHash", () => {
  it("returns the existing photo when the hash matches", async () => {
    const db = fakeDb({ id: "p1" });
    const found = await findPhotoByHash("cat1", "abc", db as never);
    expect(found).toEqual({ id: "p1" });
    expect(db.calls[0]).toEqual({ where: { catalogId: "cat1", hash: "abc" }, select: { id: true } });
  });

  it("returns null when no photo matches", async () => {
    const db = fakeDb(null);
    expect(await findPhotoByHash("cat1", "missing", db as never)).toBeNull();
  });
});
