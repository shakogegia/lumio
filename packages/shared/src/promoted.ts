import type { ExifData } from "./types.js";

/** The denormalized columns derived from a photo's EXIF (mirrors the Photo
 *  columns added in the promoted-columns migration). */
export interface PromotedFields {
  cameraMake: string | null;
  cameraModel: string | null;
  lensModel: string | null;
  iso: number | null;
  fNumber: number | null;
  focalLength: number | null;
  exposureTime: number | null;
  hasGps: boolean;
  gpsLat: number | null;
  gpsLng: number | null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Map the sanitized `exif` blob → denormalized columns. Single source of truth,
 *  used by ingest on write and by the backfill for existing rows. Never throws. */
export function derivePromotedFields(exif: ExifData): PromotedFields {
  const e = exif as Record<string, unknown>;
  const gpsLat = num(e.latitude);
  const gpsLng = num(e.longitude);
  return {
    cameraMake: str(e.cameraMake) ?? str(e.Make),
    cameraModel: str(e.cameraModel) ?? str(e.Model),
    lensModel: str(e.LensModel),
    iso: num(e.ISO) ?? num(e.ISOSpeedRatings),
    fNumber: num(e.FNumber),
    focalLength: num(e.FocalLength),
    exposureTime: num(e.ExposureTime),
    hasGps: gpsLat !== null && gpsLng !== null,
    gpsLat,
    gpsLng,
  };
}
