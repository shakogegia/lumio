import type { PrismaClient } from "@lumio/db";
import { parseExifDate } from "./metadata.js";

/**
 * Backfill `takenAt` (and the derived `sortDate`) for photos whose `takenAt` is
 * null but whose stored EXIF carries a parseable capture date. exifr returns the
 * date as a *string* for some files (e.g. PNGs), which the original strict parser
 * dropped — so `sortDate` fell back to the file date and mis-ordered the "taken"
 * sort / calendar / date filters. Sets `sortDate = takenAt` for each recovered row.
 *
 * Idempotent: only `takenAt`-null rows are considered, so re-running never
 * re-touches an already-correct (or freshly-ingested) photo. Returns the count.
 */
export async function backfillTakenAt(db: Pick<PrismaClient, "photo">): Promise<number> {
  const rows = await db.photo.findMany({
    where: { takenAt: null },
    select: { id: true, exif: true },
  });
  let updated = 0;
  for (const row of rows) {
    const exif = (row.exif ?? {}) as Record<string, unknown>;
    const taken = parseExifDate(exif.DateTimeOriginal ?? exif.CreateDate);
    if (!taken) continue;
    await db.photo.update({ where: { id: row.id }, data: { takenAt: taken, sortDate: taken } });
    updated += 1;
  }
  return updated;
}
