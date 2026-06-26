import { FieldType, FieldKind, RuleOp } from "./enums.js";
import { StandardFieldKey } from "./metadata-standard.js";
import { ValueType, type FieldDef, type SearchRegistry } from "./filters.js";
import type { MetadataSchema } from "./metadata-resolve.js";

/** Standard (EXIF-backed) field → promoted Photo column + its value type. */
export const STANDARD_COLUMN: Record<StandardFieldKey, { column: string; valueType: ValueType }> = {
  [StandardFieldKey.Camera]: { column: "cameraModel", valueType: ValueType.string },
  [StandardFieldKey.Lens]: { column: "lensModel", valueType: ValueType.string },
  [StandardFieldKey.Iso]: { column: "iso", valueType: ValueType.number },
  [StandardFieldKey.Shutter]: { column: "exposureTime", valueType: ValueType.number },
  [StandardFieldKey.Aperture]: { column: "fNumber", valueType: ValueType.number },
  [StandardFieldKey.Focal]: { column: "focalLength", valueType: ValueType.number },
  [StandardFieldKey.Date]: { column: "takenAt", valueType: ValueType.date },
};

/** Metadata field UI type → engine value type. */
export function metadataFieldToValueType(t: FieldType): ValueType {
  if (t === FieldType.Number) return ValueType.number;
  if (t === FieldType.Date) return ValueType.date;
  return ValueType.string; // text | textarea | choice
}

const STRING_OPS = [RuleOp.eq, RuleOp.ne, RuleOp.contains, RuleOp.not_contains, RuleOp.in_list, RuleOp.not_in_list, RuleOp.exists, RuleOp.not_exists];
const CHOICE_OPS = [RuleOp.eq, RuleOp.in_list, RuleOp.not_in_list, RuleOp.exists, RuleOp.not_exists];
const CUSTOM_NUM_OPS = [RuleOp.eq, RuleOp.ne, RuleOp.in_list, RuleOp.exists, RuleOp.not_exists]; // no range (text-stored)
const STD_NUM_OPS = [RuleOp.eq, RuleOp.ne, RuleOp.gt, RuleOp.gte, RuleOp.lt, RuleOp.lte, RuleOp.between, RuleOp.exists, RuleOp.not_exists];
const STD_DATE_OPS = [RuleOp.eq, RuleOp.ne, RuleOp.gt, RuleOp.gte, RuleOp.lt, RuleOp.lte, RuleOp.between, RuleOp.last_30_days, RuleOp.exists, RuleOp.not_exists];

/**
 * Build a per-catalog field registry from the metadata schema. Only enabled
 * fields are searchable. Custom fields compile to a PhotoMetadataValue relation;
 * standard (EXIF-backed) fields to their promoted column (string ones use the
 * effective override-or-EXIF value — handled in the compiler).
 */
export function buildSearchRegistry(schema: MetadataSchema): SearchRegistry {
  const reg: SearchRegistry = new Map();
  for (const group of schema) {
    for (const f of group.fields) {
      if (!f.enabled) continue;
      if (f.kind === FieldKind.Standard && f.builtinKey) {
        const std = STANDARD_COLUMN[f.builtinKey as StandardFieldKey];
        if (!std) continue;
        const ops =
          std.valueType === ValueType.string ? STRING_OPS
          : std.valueType === ValueType.date ? STD_DATE_OPS
          : STD_NUM_OPS;
        const def: FieldDef = {
          key: f.key, label: f.label, type: std.valueType,
          storage: { kind: "standard", column: std.column, fieldId: f.id }, ops,
        };
        reg.set(f.key, def);
      } else {
        const vt = metadataFieldToValueType(f.type);
        const ops =
          f.type === FieldType.Choice ? CHOICE_OPS
          : vt === ValueType.string ? STRING_OPS
          : CUSTOM_NUM_OPS; // number | date custom → no range
        const def: FieldDef = {
          key: f.key, label: f.label, type: vt,
          storage: { kind: "metadata", fieldId: f.id }, ops,
        };
        reg.set(f.key, def);
      }
    }
  }
  return reg;
}
