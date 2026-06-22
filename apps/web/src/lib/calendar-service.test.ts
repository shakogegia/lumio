import { describe, expect, it } from "vitest";
import { buildCalendarFacets } from "./calendar-service.js";

const CAT = "cat1";

// Rows are supplied newest-first (sortDate desc, id desc) — exactly the order the
// service requests from Prisma — because bucketing trusts that order for covers.
function fakeDb(rows: Array<{ id: string; sortDate: Date }>) {
  const calls: Array<{ where?: unknown; select?: unknown; orderBy?: unknown }> = [];
  return {
    calls,
    photo: {
      findMany: async (args: { where?: unknown; select?: unknown; orderBy?: unknown }) => {
        calls.push(args);
        return rows;
      },
    },
  };
}

const d = (iso: string) => new Date(iso);

describe("buildCalendarFacets", () => {
  it("queries minimal rows newest-first scoped by the where AND catalogId", async () => {
    const db = fakeDb([]);
    await buildCalendarFacets(CAT, { albums: { some: { albumId: "a" } } }, db as never);
    expect(db.calls[0]?.where).toEqual({ catalogId: CAT, albums: { some: { albumId: "a" } } });
    expect(db.calls[0]?.select).toEqual({ id: true, sortDate: true });
    expect(db.calls[0]?.orderBy).toEqual([{ sortDate: "desc" }, { id: "desc" }]);
  });

  it("always includes catalogId in the where even for an empty scope", async () => {
    const db = fakeDb([]);
    await buildCalendarFacets(CAT, {}, db as never);
    expect(db.calls[0]?.where).toEqual({ catalogId: CAT });
  });

  it("buckets photos into descending years and months with counts", async () => {
    const db = fakeDb([
      { id: "p5", sortDate: d("2026-06-20T00:00:00.000Z") },
      { id: "p4", sortDate: d("2026-06-01T00:00:00.000Z") },
      { id: "p3", sortDate: d("2026-01-15T00:00:00.000Z") },
      { id: "p2", sortDate: d("2025-12-31T00:00:00.000Z") },
      { id: "p1", sortDate: d("2025-12-01T00:00:00.000Z") },
    ]);
    const facets = await buildCalendarFacets(CAT, {}, db as never);
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
    const facets = await buildCalendarFacets(CAT, {}, db as never);
    expect(facets.years[0]?.months[0]?.coverId).toBe("newest");
  });

  it("buckets by UTC month boundaries", async () => {
    const db = fakeDb([{ id: "p", sortDate: d("2026-06-30T23:30:00.000Z") }]);
    const facets = await buildCalendarFacets(CAT, {}, db as never);
    expect(facets.years[0]?.year).toBe(2026);
    expect(facets.years[0]?.months[0]?.month).toBe(6);
  });

  it("returns no years for an empty scope", async () => {
    const facets = await buildCalendarFacets(CAT, {}, fakeDb([]) as never);
    expect(facets.years).toEqual([]);
  });
});
