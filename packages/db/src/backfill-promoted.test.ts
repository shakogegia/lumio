import { describe, expect, it, vi } from "vitest";
import { backfillPromoted } from "./backfill-promoted.js";

function fakeDb(rows: Array<{ id: string; exif: unknown }>) {
  const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
  let served = false;
  const db = {
    photo: {
      findMany: vi.fn(async () => {
        if (served) return [];
        served = true;
        return rows;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        updates.push({ id: where.id, data });
        return { id: where.id };
      }),
    },
  };
  return { db, updates };
}

describe("backfillPromoted", () => {
  it("derives and writes columns for each row, returns the count", async () => {
    const { db, updates } = fakeDb([
      { id: "p1", exif: { cameraModel: "iPhone 15", ISO: 200 } },
      { id: "p2", exif: { Make: "Canon", FNumber: 2.8 } },
    ]);
    const n = await backfillPromoted(db as never, 1000);
    expect(n).toBe(2);
    expect(updates[0]).toMatchObject({ id: "p1", data: { cameraModel: "iPhone 15", iso: 200 } });
    expect(updates[1]!.data).toMatchObject({ cameraMake: "Canon", fNumber: 2.8 });
  });
});
