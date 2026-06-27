import { z } from "zod";
import { MatchType, RuleOp } from "./enums.js";

/** The value-type of a searchable field — drives valid operators + UI widget. */
export enum ValueType {
  string = "string",
  number = "number",
  date = "date",
  bool = "bool",
}

export type FieldStorage =
  | { kind: "column"; column: string } // promoted Photo column
  | { kind: "json"; path: string[] } // exif JSONB path
  | { kind: "album" } // membership (special)
  | { kind: "filename" } // Photo.path (special)
  | { kind: "metadata"; fieldId: string } // custom field → PhotoMetadataValue relation
  | { kind: "standard"; column: string; fieldId: string }; // EXIF-backed → effective value

export interface FieldDef {
  key: string;
  label: string;
  type: ValueType;
  storage: FieldStorage;
  ops: RuleOp[];
  aliases?: string[];
}

/** Per-catalog field resolver: field key → its def. Built from the metadata schema. */
export type SearchRegistry = Map<string, FieldDef>;

const STR_OPS = [RuleOp.eq, RuleOp.ne, RuleOp.contains, RuleOp.exists, RuleOp.not_exists];
const STR_COL_OPS = [
  RuleOp.eq, RuleOp.ne, RuleOp.contains, RuleOp.in_list, RuleOp.not_in_list,
  RuleOp.exists, RuleOp.not_exists,
];
const NUM_OPS = [
  RuleOp.eq, RuleOp.ne, RuleOp.gt, RuleOp.gte, RuleOp.lt, RuleOp.lte,
  RuleOp.between, RuleOp.exists, RuleOp.not_exists,
];
const DATE_OPS = [RuleOp.gt, RuleOp.gte, RuleOp.lt, RuleOp.lte, RuleOp.between, RuleOp.exists, RuleOp.not_exists, RuleOp.last_30_days];

export const FIELD_REGISTRY: Record<string, FieldDef> = {
  cameraMake: { key: "cameraMake", label: "Camera make", type: ValueType.string, storage: { kind: "column", column: "cameraMake" }, ops: STR_COL_OPS, aliases: ["make"] },
  cameraModel: { key: "cameraModel", label: "Camera", type: ValueType.string, storage: { kind: "column", column: "cameraModel" }, ops: STR_COL_OPS, aliases: ["camera", "model"] },
  lensModel: { key: "lensModel", label: "Lens", type: ValueType.string, storage: { kind: "column", column: "lensModel" }, ops: STR_COL_OPS, aliases: ["lens"] },
  iso: { key: "iso", label: "ISO", type: ValueType.number, storage: { kind: "column", column: "iso" }, ops: NUM_OPS },
  aperture: { key: "aperture", label: "Aperture", type: ValueType.number, storage: { kind: "column", column: "fNumber" }, ops: NUM_OPS, aliases: ["fnumber", "f"] },
  focalLength: { key: "focalLength", label: "Focal length", type: ValueType.number, storage: { kind: "column", column: "focalLength" }, ops: NUM_OPS, aliases: ["focal"] },
  exposureTime: { key: "exposureTime", label: "Shutter", type: ValueType.number, storage: { kind: "column", column: "exposureTime" }, ops: NUM_OPS, aliases: ["shutter", "exposure"] },
  takenAt: { key: "takenAt", label: "Date taken", type: ValueType.date, storage: { kind: "column", column: "takenAt" }, ops: DATE_OPS, aliases: ["date", "taken"] },
  orientation: { key: "orientation", label: "Orientation", type: ValueType.number, storage: { kind: "json", path: ["orientation"] }, ops: [RuleOp.eq, RuleOp.ne, RuleOp.gte, RuleOp.lt] },
  hasGps: { key: "hasGps", label: "Has location", type: ValueType.bool, storage: { kind: "column", column: "hasGps" }, ops: [RuleOp.eq], aliases: ["gps", "located"] },
  album: { key: "album", label: "Album", type: ValueType.string, storage: { kind: "album" }, ops: [RuleOp.in_album, RuleOp.not_in_album] },
  filename: { key: "filename", label: "Filename", type: ValueType.string, storage: { kind: "filename" }, ops: [RuleOp.contains, RuleOp.eq] },
  extension: { key: "extension", label: "File type", type: ValueType.string, storage: { kind: "column", column: "extension" }, ops: [RuleOp.eq, RuleOp.ne, RuleOp.in_list, RuleOp.not_in_list], aliases: ["ext", "filetype"] },
};

/**
 * Built-in "system" fields admitted through the per-catalog search gate even when
 * they are not part of a catalog's metadata schema. These are hard file facts the
 * user never configures (vs. user-curated metadata fields). Keep this set tight —
 * it deliberately does NOT open the whole FIELD_REGISTRY to the search page.
 */
export const SYSTEM_FIELD_KEYS = new Set<string>(["extension"]);

const GENERIC_JSON_OPS = [
  RuleOp.eq, RuleOp.ne, RuleOp.contains, RuleOp.gt, RuleOp.gte, RuleOp.lt,
  RuleOp.lte, RuleOp.exists, RuleOp.not_exists,
];

const ALIAS_INDEX: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const def of Object.values(FIELD_REGISTRY)) {
    m[def.key.toLowerCase()] = def.key;
    for (const a of def.aliases ?? []) m[a.toLowerCase()] = def.key;
  }
  return m;
})();

/**
 * Resolve a field key/alias to its definition. Unknown keys and any `exif.<Key>`
 * resolve to a generic JSONB field so *any* EXIF key is searchable. The generic
 * path preserves the original casing (EXIF keys are case-sensitive).
 */
export function resolveField(key: string): FieldDef {
  const direct = ALIAS_INDEX[key.toLowerCase()];
  if (direct) return FIELD_REGISTRY[direct]!;
  // NB: the exif. prefix must be lowercase (matches the wire format / token grammar).
  const path = key.startsWith("exif.") ? key.slice("exif.".length) : key;
  return {
    key: `exif.${path}`,
    label: path,
    type: ValueType.string,
    storage: { kind: "json", path: [path] },
    ops: GENERIC_JSON_OPS,
  };
}

export type FilterValue =
  | string | number | boolean
  | [number, number] | [string, string]
  | string[];

export interface FilterRule {
  field: string;
  op: RuleOp;
  value?: FilterValue;
}

export interface FilterSet {
  match: MatchType;
  rules: FilterRule[];
}

const NO_VALUE_OPS = new Set<RuleOp>([RuleOp.exists, RuleOp.not_exists, RuleOp.last_30_days]);
const LIST_OPS = new Set<RuleOp>([RuleOp.in_album, RuleOp.not_in_album, RuleOp.in_list, RuleOp.not_in_list]);

const ruleSchema = z
  .object({
    field: z.string().min(1),
    op: z.nativeEnum(RuleOp),
    value: z.unknown().optional(),
  })
  .superRefine((rule, ctx) => {
    const def = resolveField(rule.field);
    // Known static fields keep strict op-gating. An unknown key resolves to a
    // generic `exif.*` def; its real ops are decided by the per-catalog metadata
    // registry at the search boundary, so don't reject its op here.
    const generic = def.key.startsWith("exif.");
    if (!generic && !def.ops.includes(rule.op)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `op ${rule.op} invalid for field ${rule.field}` });
      return;
    }
    if (NO_VALUE_OPS.has(rule.op)) return; // value ignored
    if (LIST_OPS.has(rule.op)) {
      if (!Array.isArray(rule.value) || rule.value.length === 0 || rule.value.some((v) => typeof v !== "string")) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "list op requires a non-empty string[]" });
      }
      return;
    }
    // Strict value typing only for promoted columns whose type we know; generic
    // JSON fields stay permissive (an arbitrary EXIF key may hold any JSON scalar).
    const typedCol = def.storage.kind === "column" ? def.type : null;
    const v = rule.value;

    if (rule.op === RuleOp.between) {
      if (!Array.isArray(v) || v.length !== 2) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "between requires a [min, max] tuple" });
        return;
      }
      if (typedCol === ValueType.number && v.some((x) => typeof x !== "number" || !Number.isFinite(x))) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "between on a numeric field requires finite numbers" });
      } else if (typedCol === ValueType.date && v.some((x) => typeof x !== "string")) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "between on a date field requires ISO strings" });
      }
      return;
    }

    // scalar ops (eq/ne/contains/gt/gte/lt/lte)
    if (v === undefined || v === null || Array.isArray(v)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `op ${rule.op} requires a scalar value` });
      return;
    }
    if (typedCol === ValueType.number && (typeof v !== "number" || !Number.isFinite(v))) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${rule.field} requires a finite number` });
    } else if (typedCol === ValueType.bool && typeof v !== "boolean") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${rule.field} requires a boolean` });
    } else if (typedCol === ValueType.date && typeof v !== "string") {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${rule.field} requires an ISO date string` });
    }
  });

export const filterSetSchema = z.object({
  match: z.nativeEnum(MatchType),
  rules: z.array(ruleSchema).max(100),
});
