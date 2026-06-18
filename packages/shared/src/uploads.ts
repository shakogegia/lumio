import { z } from "zod";

export const DEFAULT_UPLOAD_TEMPLATE = "{YYYY}/{YYYY}-{MM}-{DD}/{filename}";

const pad = (n: number): string => String(n).padStart(2, "0");

/** Replace path separators and whitespace in an uploaded filename with underscores. */
function sanitizeFilename(name: string): string {
  return name.replace(/[/\\\s]/g, "_");
}

export interface TemplateContext {
  date: Date;
  originalFilename: string;
}

/** Render a token template into a POSIX relative path. Date parts are UTC. */
export function renderTemplate(template: string, ctx: TemplateContext): string {
  const filename = sanitizeFilename(ctx.originalFilename);
  const dot = filename.lastIndexOf(".");
  const ext = dot > 0 ? filename.slice(dot + 1) : "";
  const tokens: Record<string, string> = {
    "{YYYY}": String(ctx.date.getUTCFullYear()),
    "{MM}": pad(ctx.date.getUTCMonth() + 1),
    "{DD}": pad(ctx.date.getUTCDate()),
    "{filename}": filename,
    "{ext}": ext,
  };
  return template.replace(/\{YYYY\}|\{MM\}|\{DD\}|\{filename\}|\{ext\}/g, (m) => tokens[m] ?? m);
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

export const updateSettingsSchema = z.object({
  uploadTemplate: z
    .string()
    .refine((t) => validateTemplate(t).ok, { message: "Invalid upload template" }),
});

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
