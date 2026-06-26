import { describe, expect, it, vi } from "vitest";
import { backfillTakenAt } from "./backfill-taken-at.js";

describe("backfillTakenAt", () => {
  it("recovers takenAt + sortDate from string EXIF dates and skips rows without a parseable one", async () => {
    const updates: { id: string; takenAt: Date; sortDate: Date }[] = [];
    const db = {
      photo: {
        findMany: vi.fn(async () => [
          { id: "a", exif: { DateTimeOriginal: "2024-07-30T22:52:33.00" } },
          { id: "b", exif: { CreateDate: "2023:10:23 23:05:51" } },
          { id: "x", exif: { "xmp:CreateDate": "2023-11-12T21:36:53", "xmp:ModifyDate": "2026-01-01T00:00:00" } },
          { id: "c", exif: {} }, // no date → skipped
          { id: "d", exif: { DateTimeOriginal: "not a date" } }, // unparseable → skipped
        ]),
        update: vi.fn(
          async ({ where, data }: { where: { id: string }; data: { takenAt: Date; sortDate: Date } }) => {
            updates.push({ id: where.id, ...data });
            return {};
          },
        ),
      },
    } as unknown as Parameters<typeof backfillTakenAt>[0];

    const n = await backfillTakenAt(db);
    expect(n).toBe(3);
    expect(updates).toEqual([
      { id: "a", takenAt: new Date("2024-07-30T22:52:33.000Z"), sortDate: new Date("2024-07-30T22:52:33.000Z") },
      { id: "b", takenAt: new Date("2023-10-23T23:05:51.000Z"), sortDate: new Date("2023-10-23T23:05:51.000Z") },
      { id: "x", takenAt: new Date("2023-11-12T21:36:53.000Z"), sortDate: new Date("2023-11-12T21:36:53.000Z") },
    ]);
  });
});
