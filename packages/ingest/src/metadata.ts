import exifr from "exifr";
import type { ExifData } from "@lumio/shared";

/**
 * Recursively convert exifr output into a JSON-serialisable value for the
 * `Photo.exif` JSONB column: Date → ISO string; Buffers / typed arrays /
 * functions / non-finite numbers dropped; objects and arrays recursed;
 * NUL bytes (\u0000) stripped from strings and keys (PostgreSQL jsonb cannot store them).
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
      if (s !== undefined) out[k.replace(/\u0000/g, "")] = s;
    }
    return out;
  }
  if (typeof value === "string") return value.replace(/\u0000/g, "");
  if (typeof value === "number" && !Number.isFinite(value)) return undefined;
  return value; // number | boolean
}

/** Every block exifr can read, grouped (not merged) so we can flatten with namespace-prefixing ourselves. */
const EXIFR_OPTIONS = {
  tiff: true,
  exif: true,
  gps: true,
  xmp: true,
  iptc: true,
  jfif: true,
  ihdr: true,
  interop: true,
  mergeOutput: false,
};

function parseExifDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  return null;
}

/**
 * exifr block groups whose keys are hoisted to the top level (keeping their
 * friendly names, e.g. `Make`, `FNumber`, `LightSource`). Everything else in
 * mergeOutput:false output is an XMP namespace (e.g. `filmexif`, `aux`, `crs`,
 * `dc`), whose keys we prefix as `namespace:Tag` so custom tags never collide
 * with a standard EXIF tag of the same name (e.g. filmexif:LightSource vs the
 * standard LightSource enum).
 */
const STANDARD_BLOCKS = [
  "ifd0",
  "exif",
  "gps",
  "interop",
  "iptc",
  "jfif",
  "ihdr",
  "icc",
  "ifd1",
  "thumbnail",
  "makerNote",
];

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    !(v instanceof Date) &&
    !Buffer.isBuffer(v) &&
    !ArrayBuffer.isView(v)
  );
}

/**
 * Flatten exifr's grouped (mergeOutput:false) output into one object: hoist
 * standard blocks to the top level (first-wins on duplicate keys so primary
 * IFDs beat the thumbnail IFD), and prefix every other group (XMP namespaces)
 * by its name so same-named custom tags don't collide with standard ones.
 */
export function flattenMetadata(grouped: Record<string, unknown>): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  for (const block of STANDARD_BLOCKS) {
    const group = grouped[block];
    if (isPlainObject(group)) {
      for (const [k, v] of Object.entries(group)) {
        if (!(k in flat)) flat[k] = v;
      }
    }
  }
  for (const [name, group] of Object.entries(grouped)) {
    if (STANDARD_BLOCKS.includes(name)) continue;
    if (isPlainObject(group)) {
      for (const [k, v] of Object.entries(group)) flat[`${name}:${k}`] = v;
    } else {
      flat[name] = group;
    }
  }
  return flat;
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
  const flat = flattenMetadata(raw);
  const exif = sanitizeMetadata(flat) as ExifData;

  const takenAt = parseExifDate(flat.DateTimeOriginal ?? flat.CreateDate);
  const curated: ExifData = {
    takenAt: takenAt ? takenAt.toISOString() : undefined,
    // Derive the camera strings from the already-sanitized `exif` (NUL-stripped),
    // not raw `flat`, so a curated alias can never reintroduce a NUL into the
    // jsonb-bound object.
    cameraMake: typeof exif.Make === "string" ? exif.Make.trim() : undefined,
    cameraModel: typeof exif.Model === "string" ? exif.Model.trim() : undefined,
    orientation: typeof flat.Orientation === "number" ? flat.Orientation : undefined,
  };
  // Curated keys are canonical aliases consumed by the sort/smart-album layer.
  // They always take precedence over any same-named key in the raw dump.
  for (const [k, v] of Object.entries(curated)) {
    if (v !== undefined) exif[k] = v;
  }

  return { exif, takenAt };
}
