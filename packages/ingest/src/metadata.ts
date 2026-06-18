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
