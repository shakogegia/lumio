import type { ExifData } from "./types.js";

/** The small set of standardized fields shown icon-led in the Info tab. */
export enum StandardFieldKey {
  Camera = "camera",
  Lens = "lens",
  Iso = "iso",
  Shutter = "shutter",
  Aperture = "aperture",
  Focal = "focal",
  Date = "date",
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}
function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** ExposureTime (seconds) → "1/100 s" under 1s, "2 s" at/above. */
export function formatShutter(seconds: unknown): string | null {
  const t = num(seconds);
  if (t === undefined || t <= 0) return null;
  if (t >= 1) return `${Number.isInteger(t) ? t : Number(t.toFixed(1))} s`;
  return `1/${Math.round(1 / t)} s`;
}

/** FNumber → "ƒ/8". */
export function formatAperture(fnumber: unknown): string | null {
  const f = num(fnumber);
  if (f === undefined || f <= 0) return null;
  return `ƒ/${Number(f.toFixed(1)).toString().replace(/\.0$/, "")}`;
}

/** FocalLength → "55 mm". */
export function formatFocal(mm: unknown): string | null {
  const f = num(mm);
  if (f === undefined || f <= 0) return null;
  return `${Number(f.toFixed(1)).toString().replace(/\.0$/, "")} mm`;
}

/** Make + Model, de-duplicated (Model frequently repeats the Make). */
export function formatCamera(make: unknown, model: unknown): string | null {
  const mk = str(make);
  const md = str(model);
  if (mk && md) {
    // "NIKON CORPORATION" + "NIKON D800" → "NIKON D800" (first word of make matches start of model)
    const mkFirst = mk.split(/\s+/)[0]!;
    return md.toLowerCase().startsWith(mkFirst.toLowerCase()) ? md : `${mk} ${md}`;
  }
  return md ?? mk ?? null;
}

function formatDate(value: unknown): string | null {
  const s = str(value);
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export type StandardFieldValues = Record<StandardFieldKey, string | null>;

/** Resolve every standard field to a display string (or null) from an exif blob. */
export function resolveStandardFields(exif: ExifData): StandardFieldValues {
  const e = exif as Record<string, unknown>;
  const iso = num(e.ISO);
  return {
    [StandardFieldKey.Camera]: formatCamera(e.cameraMake ?? e.Make, e.cameraModel ?? e.Model),
    [StandardFieldKey.Lens]: str(e.LensModel) ?? null,
    [StandardFieldKey.Iso]: iso === undefined ? null : `ISO ${iso}`,
    [StandardFieldKey.Shutter]: formatShutter(e.ExposureTime),
    [StandardFieldKey.Aperture]: formatAperture(e.FNumber),
    [StandardFieldKey.Focal]: formatFocal(e.FocalLength),
    [StandardFieldKey.Date]: formatDate(e.DateTimeOriginal ?? e.CreateDate),
  };
}

/** The pre-composed lines the icon-led component renders, or null when the photo
 *  carries no standard fields at all. Pure, so the composition + empty-check are
 *  unit-tested in node (the web package has no React render-test harness). */
export interface StandardMetadataLines {
  camera: string | null;
  exposure: string | null; // "1/500 s  ISO 3200"
  optics: string | null; // "ƒ/10  55 mm"
  date: string | null;
}

export function standardMetadataLines(exif: ExifData): StandardMetadataLines | null {
  const f = resolveStandardFields(exif);
  const join = (parts: Array<string | null>) => parts.filter(Boolean).join("  ") || null;
  const lines: StandardMetadataLines = {
    camera: f[StandardFieldKey.Camera],
    exposure: join([f[StandardFieldKey.Shutter], f[StandardFieldKey.Iso]]),
    optics: join([f[StandardFieldKey.Aperture], f[StandardFieldKey.Focal]]),
    date: f[StandardFieldKey.Date],
  };
  if (!lines.camera && !lines.exposure && !lines.optics && !lines.date) return null;
  return lines;
}
