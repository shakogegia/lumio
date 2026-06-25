import { type Prisma, type PrismaClient, prisma } from "@lumio/db";
import type { CalendarFacets, CalendarMonthFacet } from "@lumio/shared";
import { LIVE_PHOTO } from "@/lib/server/photo-filters";

type Db = Pick<PrismaClient, "photo">;

interface YearAcc {
  year: number;
  count: number;
  months: Map<number, CalendarMonthFacet>;
}

/**
 * Build the year → month facet tree for a navigation scope (`where`), powering
 * the calendar month-filter flyout. Pulls the scope's photos as minimal
 * {id, sortDate} rows newest-first and buckets them in memory: the first id seen
 * for a (year, month) is that month's cover (it is the newest), and the running
 * tally is the count. Grouping is by `sortDate` (takenAt ?? earliest file created/modified date) in UTC,
 * so results are deterministic regardless of server timezone.
 *
 * Scope-agnostic by design: callers pass the same `where` the list endpoints use
 * (library `{}`, album membership / smart-rule, search), so facets can never
 * drift from what the grid shows. Mirrors `getNeighborsForWhere`.
 *
 * `catalogId` is ANDed with the caller-supplied `where` so photos from other
 * catalogs can never appear in the facets.
 */
export async function buildCalendarFacets(
  catalogId: string,
  where: Prisma.PhotoWhereInput,
  db: Db = prisma,
): Promise<CalendarFacets> {
  const scopedWhere: Prisma.PhotoWhereInput = { catalogId, ...LIVE_PHOTO, ...where };
  const rows = await db.photo.findMany({
    where: scopedWhere,
    select: { id: true, sortDate: true },
    orderBy: [{ sortDate: "desc" }, { id: "desc" }],
  });

  const years = new Map<number, YearAcc>();
  for (const { id, sortDate } of rows) {
    const year = sortDate.getUTCFullYear();
    const month = sortDate.getUTCMonth() + 1; // 1–12
    let acc = years.get(year);
    if (!acc) {
      acc = { year, count: 0, months: new Map() };
      years.set(year, acc);
    }
    acc.count += 1;
    const existing = acc.months.get(month);
    if (existing) {
      existing.count += 1;
    } else {
      // First (newest) row for this month becomes the cover.
      acc.months.set(month, { month, count: 1, coverId: id });
    }
  }

  return {
    years: [...years.values()]
      .sort((a, b) => b.year - a.year)
      .map((y) => ({
        year: y.year,
        count: y.count,
        months: [...y.months.values()].sort((a, b) => b.month - a.month),
      })),
  };
}
