import type { ExifData } from "@lumio/shared";

export function formatExifValue(value: unknown): string {
  if (value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

/** Flatten EXIF into sorted [key, value] pairs for the full metadata dump. */
export function exifEntries(exif: ExifData): Array<[string, string]> {
  return Object.entries(exif)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => [k, formatExifValue(v)] as [string, string])
    .sort((a, b) => a[0].localeCompare(b[0]));
}

/** Case-insensitive filter over [key, value] pairs; an empty query returns all. */
export function filterExifEntries(
  entries: Array<[string, string]>,
  query: string,
): Array<[string, string]> {
  const q = query.trim().toLowerCase();
  if (!q) return entries;
  return entries.filter(
    ([key, value]) => key.toLowerCase().includes(q) || value.toLowerCase().includes(q),
  );
}
