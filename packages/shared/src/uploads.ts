export const DEFAULT_UPLOAD_TEMPLATE = "{TAKEN_YYYY}/{TAKEN_YYYY}-{TAKEN_MM}-{TAKEN_DD}/{filename}";

const pad = (n: number): string => String(n).padStart(2, "0");

/** Replace path separators and whitespace in an uploaded filename with underscores. */
function sanitizeFilename(name: string): string {
  return name.replace(/[/\\\s]/g, "_");
}

export interface TemplateContext {
  /** Capture date — EXIF taken-at, falling back to file-modified then upload time. */
  date: Date;
  /** Wall-clock time the upload is happening, for the {NOW_*} tokens. */
  now: Date;
  originalFilename: string;
}

/** Render a token template into a POSIX relative path. Date parts are UTC. */
export function renderTemplate(template: string, ctx: TemplateContext): string {
  const filename = sanitizeFilename(ctx.originalFilename);
  const dot = filename.lastIndexOf(".");
  const ext = dot > 0 ? filename.slice(dot + 1) : "";
  const taken = {
    YYYY: String(ctx.date.getUTCFullYear()),
    MM: pad(ctx.date.getUTCMonth() + 1),
    DD: pad(ctx.date.getUTCDate()),
  };
  const tokens: Record<string, string> = {
    // Taken-at date: when the photo was captured (EXIF, with fallbacks).
    "{TAKEN_YYYY}": taken.YYYY,
    "{TAKEN_MM}": taken.MM,
    "{TAKEN_DD}": taken.DD,
    // Current date: when the upload happens.
    "{NOW_YYYY}": String(ctx.now.getUTCFullYear()),
    "{NOW_MM}": pad(ctx.now.getUTCMonth() + 1),
    "{NOW_DD}": pad(ctx.now.getUTCDate()),
    "{filename}": filename,
    "{ext}": ext,
    // Legacy unprefixed aliases for the taken-at date (templates saved before
    // the TAKEN_ prefix existed — keep rendering them identically).
    "{YYYY}": taken.YYYY,
    "{MM}": taken.MM,
    "{DD}": taken.DD,
  };
  return template.replace(
    /\{TAKEN_YYYY\}|\{TAKEN_MM\}|\{TAKEN_DD\}|\{NOW_YYYY\}|\{NOW_MM\}|\{NOW_DD\}|\{filename\}|\{ext\}|\{YYYY\}|\{MM\}|\{DD\}/g,
    (m) => tokens[m] ?? m,
  );
}

export type TemplateValidation = { ok: true } | { ok: false; error: string };

/** Reject templates that are empty, can't vary per file, or escape the root. */
export function validateTemplate(template: string): TemplateValidation {
  if (template.trim().length === 0) return { ok: false, error: "Template is empty" };
  if (!template.includes("{filename}") && !template.includes("{ext}")) {
    return { ok: false, error: "Template must include {filename} or {ext}" };
  }
  if (template.split("/").some((seg) => seg === "..")) {
    return { ok: false, error: "Template must not contain '..'" };
  }
  if (template.startsWith("/")) return { ok: false, error: "Template must not start with '/'" };
  return { ok: true };
}

