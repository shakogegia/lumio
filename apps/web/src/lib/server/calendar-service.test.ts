import { describe, expect, it } from "vitest";
import { buildCalendarFacets } from "./calendar-service.js";

const CAT = "cat1";

// Rows are supplied newest-first (sortDate desc, id desc) — exactly the order the
// service requests from Prisma — because bucketing trusts that order for covers.
function fakeDb(rows: Array<{ id: string; sortDate: Date; createdAt?: Date; fileCreatedAt?: Date | null }>) {
  const calls: Array<{ where?: unknown; select?: unknown; orderBy?: unknown }> = [];
  return {
    calls,
    photo: {
      findMany: async (args: { where?: unknown; select?: unknown; orderBy?: unknown }) => {
        calls.push(args);
        return rows;
      },
    },
    photoMetadataValue: {
      findMany: async (_args: unknown) => {
        return [];
      },
    },
  };
}

function fakeDbWithMeta(
  photoRows: Array<{ id: string; sortDate: Date; createdAt?: Date; fileCreatedAt?: Date | null }>,
  metaRows: Array<{ photoId: string; value: string }>,
) {
  const photoCalls: Array<unknown> = [];
  const metaCalls: Array<unknown> = [];
  return {
    photoCalls,
    metaCalls,
    photo: {
      findMany: async (args: unknown) => {
        photoCalls.push(args);
        return photoRows;
      },
    },
    photoMetadataValue: {
      findMany: async (args: unknown) => {
        metaCalls.push(args);
        return metaRows;
      },
    },
  };
}

const d = (iso: string) => new Date(iso);

describe("buildCalendarFacets", () => {
  it("queries minimal rows newest-first scoped by the where AND catalogId", async () => {
    const db = fakeDb([]);
    await buildCalendarFacets(CAT, { albums: { some: { albumId: "a" } } }, "taken", db as never);
    expect(db.calls[0]?.where).toEqual({ catalogId: CAT, trashedAt: null, albums: { some: { albumId: "a" } } });
    expect(db.calls[0]?.select).toEqual({ id: true, sortDate: true, createdAt: true, fileCreatedAt: true });
    expect(db.calls[0]?.orderBy).toEqual([{ sortDate: "desc" }, { id: "desc" }]);
  });

  it("always includes catalogId in the where even for an empty scope", async () => {
    const db = fakeDb([]);
    await buildCalendarFacets(CAT, {}, "taken", db as never);
    expect(db.calls[0]?.where).toEqual({ catalogId: CAT, trashedAt: null });
  });

  it("buckets photos into descending years and months with counts", async () => {
    const db = fakeDb([
      { id: "p5", sortDate: d("2026-06-20T00:00:00.000Z") },
      { id: "p4", sortDate: d("2026-06-01T00:00:00.000Z") },
      { id: "p3", sortDate: d("2026-01-15T00:00:00.000Z") },
      { id: "p2", sortDate: d("2025-12-31T00:00:00.000Z") },
      { id: "p1", sortDate: d("2025-12-01T00:00:00.000Z") },
    ]);
    const facets = await buildCalendarFacets(CAT, {}, "taken", db as never);
    expect(facets.years.map((y) => y.year)).toEqual([2026, 2025]);
    expect(facets.years[0]).toEqual({
      year: 2026,
      count: 3,
      months: [
        { month: 6, count: 2, coverId: "p5" },
        { month: 1, count: 1, coverId: "p3" },
      ],
    });
    expect(facets.years[1]).toEqual({
      year: 2025,
      count: 2,
      months: [{ month: 12, count: 2, coverId: "p2" }],
    });
  });

  it("uses the newest photo in a month as its cover", async () => {
    const db = fakeDb([
      { id: "newest", sortDate: d("2026-03-28T00:00:00.000Z") },
      { id: "older", sortDate: d("2026-03-02T00:00:00.000Z") },
    ]);
    const facets = await buildCalendarFacets(CAT, {}, "taken", db as never);
    expect(facets.years[0]?.months[0]?.coverId).toBe("newest");
  });

  it("buckets by UTC month boundaries", async () => {
    const db = fakeDb([{ id: "p", sortDate: d("2026-06-30T23:30:00.000Z") }]);
    const facets = await buildCalendarFacets(CAT, {}, "taken", db as never);
    expect(facets.years[0]?.year).toBe(2026);
    expect(facets.years[0]?.months[0]?.month).toBe(6);
  });

  it("returns no years for an empty scope", async () => {
    const facets = await buildCalendarFacets(CAT, {}, "taken", fakeDb([]) as never);
    expect(facets.years).toEqual([]);
  });

  it("buckets by createdAt when field is 'imported'", async () => {
    // sortDate differs from createdAt — assert the facet uses createdAt
    const db = fakeDb([
      {
        id: "p1",
        sortDate: d("2023-01-10T00:00:00.000Z"),
        createdAt: d("2024-03-15T00:00:00.000Z"),
        fileCreatedAt: null,
      },
      {
        id: "p2",
        sortDate: d("2023-02-10T00:00:00.000Z"),
        createdAt: d("2024-03-05T00:00:00.000Z"),
        fileCreatedAt: null,
      },
    ]);
    const facets = await buildCalendarFacets(CAT, {}, "imported", db as never);
    // Should see 2024-March (from createdAt), not 2023 (from sortDate)
    expect(facets.years.map((y) => y.year)).toEqual([2024]);
    expect(facets.years[0]?.months[0]?.month).toBe(3);
    expect(facets.years[0]?.months[0]?.count).toBe(2);
    // orderBy should start with createdAt desc
    expect((db.calls[0]?.orderBy as Array<unknown>)?.[0]).toEqual({ createdAt: "desc" });
  });

  it("buckets metadata dimension 'meta:clx1' by ISO date values from photoMetadataValue", async () => {
    const db = fakeDbWithMeta(
      [], // photo.findMany should NOT be called for meta dimensions
      [
        { photoId: "p1", value: "2024-06-15" },
        { photoId: "p2", value: "2024-06-02" },
      ],
    );
    const facets = await buildCalendarFacets(CAT, {}, "meta:clx1", db as never);
    expect(facets.years).toHaveLength(1);
    expect(facets.years[0]?.year).toBe(2024);
    expect(facets.years[0]?.months).toHaveLength(1);
    expect(facets.years[0]?.months[0]).toEqual({ month: 6, count: 2, coverId: "p1" });
    // photo.findMany should NOT have been called
    expect(db.photoCalls).toHaveLength(0);
  });
});
