import exifr from "exifr";
import type { ExifData } from "@lumio/shared";

/**
 * Recursively convert exifr output into a JSON-serialisable value for the
 * `Photo.exif` JSONB column: Date → ISO string; Buffers / typed arrays /
 * functions / non-finite numbers dropped; objects and arrays recursed.
 */
export function sanitizeMetadata(value: unknown): unknown {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  }
  if (value === null) return null;
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value) || value instanceof ArrayBuffer) {
    return undefined;
  }
  if (typeof value === "function") return undefined;
  if (Array.isArray(value)) {
    return value.map(sanitizeMetadata).filter((v) => v !== undefined);
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const s = sanitizeMetadata(v);
      if (s !== undefined) out[k] = s;
    }
    return out;
  }
  if (typeof value === "number" && !Number.isFinite(value)) return undefined;
  return value; // string | number | boolean
}

/** Every block exifr can read, merged into one flat object. */
const EXIFR_OPTIONS = {
  tiff: true,
  exif: true,
  gps: true,
  xmp: true,
  iptc: true,
  jfif: true,
  ihdr: true,
  interop: true,
  mergeOutput: true,
};

function parseExifDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  return null;
}

/**
 * Read all available metadata from an image buffer. Returns the full sanitized
 * dump (with the curated keys overlaid) plus the parsed capture date.
 */
export async function extractMetadata(
  buffer: Buffer,
): Promise<{ exif: ExifData; takenAt: Date | null }> {
  // Treat any parse failure as "no metadata" — a bad EXIF block must not
  // prevent the image from being ingested.
  const raw = ((await exifr.parse(buffer, EXIFR_OPTIONS).catch(() => null)) ?? {}) as Record<
    string,
    unknown
  >;
  const exif = sanitizeMetadata(raw) as ExifData;

  const takenAt = parseExifDate(raw.DateTimeOriginal ?? raw.CreateDate);
  const curated: ExifData = {
    takenAt: takenAt ? takenAt.toISOString() : undefined,
    cameraMake: typeof raw.Make === "string" ? raw.Make.trim() : undefined,
    cameraModel: typeof raw.Model === "string" ? raw.Model.trim() : undefined,
    orientation: typeof raw.Orientation === "number" ? raw.Orientation : undefined,
  };
  // Curated keys are canonical aliases consumed by the sort/smart-album layer.
  // They always take precedence over any same-named key in the raw dump.
  for (const [k, v] of Object.entries(curated)) {
    if (v !== undefined) exif[k] = v;
  }

  return { exif, takenAt };
}
