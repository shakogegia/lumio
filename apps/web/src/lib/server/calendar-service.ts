import { type Prisma, type PrismaClient, prisma } from "@lumio/db";
import { type CalendarField, calendarColumn, type CalendarFacets, type CalendarMonthFacet, parseCalendarMetaField } from "@lumio/shared";
import { LIVE_PHOTO } from "@/lib/server/photo-filters";

type Db = Pick<PrismaClient, "photo" | "photoMetadataValue">;

interface YearAcc {
  year: number;
  count: number;
  months: Map<number, CalendarMonthFacet>;
}

interface Entry {
  year: number;
  month: number; // 1–12
  id: string;
}

/** Newest-first (year, month, photoId) entries from a standard Photo column. */
async function columnEntries(field: CalendarField, where: Prisma.PhotoWhereInput, db: Db): Promise<Entry[]> {
  const col = calendarColumn(field);
  const rows = await db.photo.findMany({
    where,
    select: { id: true, sortDate: true, createdAt: true, fileCreatedAt: true },
    orderBy: [{ [col]: "desc" }, { id: "desc" }] as Prisma.PhotoOrderByWithRelationInput[],
  });
  const out: Entry[] = [];
  for (const r of rows) {
    const d = r[col];
    if (!d) continue; // fileCreatedAt may be null
    out.push({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, id: r.id });
  }
  return out;
}

/** Newest-first entries from a metadata Date field's ISO `YYYY-MM-DD` values. */
async function metaEntries(fieldId: string, where: Prisma.PhotoWhereInput, db: Db): Promise<Entry[]> {
  const rows = await db.photoMetadataValue.findMany({
    where: { fieldId, photo: where },
    select: { photoId: true, value: true },
    orderBy: [{ value: "desc" }, { photoId: "desc" }],
  });
  const out: Entry[] = [];
  for (const { photoId, value } of rows) {
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(5, 7));
    if (!Number.isInteger(year) || month < 1 || month > 12) continue; // skip non-ISO
    out.push({ year, month, id: photoId });
  }
  return out;
}

/**
 * Year → month facet tree for a navigation scope (`where`) on the chosen date
 * dimension (`field`). Standard dimensions bucket a Photo column; a metadata
 * dimension buckets the field's ISO values. Entries arrive newest-first so the
 * first id per (year, month) is that month's cover. UTC, deterministic.
 * `catalogId` + the live filter are ANDed with the caller `where`.
 */
export async function buildCalendarFacets(
  catalogId: string,
  where: Prisma.PhotoWhereInput,
  field: CalendarField,
  db: Db = prisma,
): Promise<CalendarFacets> {
  const scopedWhere: Prisma.PhotoWhereInput = { catalogId, ...LIVE_PHOTO, ...where };
  const metaFieldId = parseCalendarMetaField(field);
  const entries = metaFieldId
    ? await metaEntries(metaFieldId, scopedWhere, db)
    : await columnEntries(field, scopedWhere, db);

  const years = new Map<number, YearAcc>();
  for (const { year, month, id } of entries) {
    let acc = years.get(year);
    if (!acc) years.set(year, (acc = { year, count: 0, months: new Map() }));
    acc.count += 1;
    const existing = acc.months.get(month);
    if (existing) existing.count += 1;
    else acc.months.set(month, { month, count: 1, coverId: id });
  }

  return {
    years: [...years.values()]
      .sort((a, b) => b.year - a.year)
      .map((y) => ({ year: y.year, count: y.count, months: [...y.months.values()].sort((a, b) => b.month - a.month) })),
  };
}
