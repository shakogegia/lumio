import { describe, expect, it, vi } from "vitest";
import { listPhotos } from "./photos-service";

describe("live-photo filter", () => {
  it("listPhotos excludes trashed (pending) photos via trashedAt: null", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const count = vi.fn().mockResolvedValue(0);
    const db = { photo: { findMany, count } } as never;
    await listPhotos("cat1", { limit: 50, offset: 0 } as never, db);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ catalogId: "cat1", trashedAt: null }) }),
    );
    expect(count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ catalogId: "cat1", trashedAt: null }) }),
    );
  });
});
