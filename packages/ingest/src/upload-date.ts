import exifr from "exifr";
import { captureDate, EXIFR_OPTIONS, flattenMetadata } from "./metadata.js";

/**
 * Decide the date used to file an upload: the photo's capture date, else the
 * client-provided lastModified, else `now`.
 *
 * Capture-date parsing is shared with ingest (`captureDate`) so an uploaded
 * file lands in the same date folder as the `takenAt` it will be ingested
 * with — including string-typed EXIF dates and film-scan `xmp:CreateDate`,
 * which the standard `DateTimeOriginal`/`CreateDate` Date revival misses.
 */
export async function extractUploadDate(
  bytes: Buffer,
  lastModified: number | undefined,
  now: Date,
): Promise<Date> {
  const raw = ((await exifr.parse(bytes, EXIFR_OPTIONS).catch(() => null)) ?? {}) as Record<
    string,
    unknown
  >;
  const exifDate = captureDate(flattenMetadata(raw));
  if (exifDate) return exifDate;
  if (typeof lastModified === "number" && Number.isFinite(lastModified)) {
    return new Date(lastModified);
  }
  return now;
}
