import exifr from "exifr";

function parseDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  return null;
}

/**
 * Decide the date used to file an upload: EXIF DateTimeOriginal/CreateDate,
 * else the client-provided lastModified, else `now`.
 */
export async function extractUploadDate(
  bytes: Buffer,
  lastModified: number | undefined,
  now: Date,
): Promise<Date> {
  const raw = (await exifr.parse(bytes).catch(() => null)) ?? {};
  const exifDate = parseDate(raw.DateTimeOriginal) ?? parseDate(raw.CreateDate);
  if (exifDate) return exifDate;
  if (typeof lastModified === "number" && Number.isFinite(lastModified)) {
    return new Date(lastModified);
  }
  return now;
}
