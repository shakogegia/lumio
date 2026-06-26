"use client";

import type { MetadataSchema, MetadataFieldDef, FilterRule } from "@lumio/shared";
import { FieldType, FieldKind, StandardFieldKey, STANDARD_COLUMN, ValueType } from "@lumio/shared";
import { FacetText } from "./facet-text";
import { FacetMultiselect } from "./facet-multiselect";
import { FacetRange } from "./facet-range";
import { FacetDate } from "./facet-date";
import { FacetEquality } from "./facet-equality";

export function MetadataFacets({
  groups,
  slug,
  rules,
  onRules,
}: {
  groups: MetadataSchema; // already filtered to enabled fields, non-empty groups
  slug: string;
  rules: FilterRule[];
  onRules: (next: FilterRule[]) => void;
}) {
  return (
    <div className="space-y-4">
      {groups.map((group) => (
        <div key={group.id} className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {group.label}
          </p>
          {group.fields.map((f) => (
            <Facet key={f.id} field={f} slug={slug} rules={rules} onRules={onRules} />
          ))}
        </div>
      ))}
    </div>
  );
}

function Facet({
  field: f,
  slug,
  rules,
  onRules,
}: {
  field: MetadataFieldDef;
  slug: string;
  rules: FilterRule[];
  onRules: (n: FilterRule[]) => void;
}) {
  const common = { fieldKey: f.key, label: f.label, rules, onRules };

  if (f.kind === FieldKind.Standard && f.builtinKey) {
    const col = STANDARD_COLUMN[f.builtinKey as StandardFieldKey];
    const vt = col?.valueType;
    if (vt === ValueType.number) {
      const step = f.builtinKey === StandardFieldKey.Aperture ? "0.1" : undefined;
      return <FacetRange {...common} step={step} />;
    }
    if (vt === ValueType.date) return <FacetDate {...common} />;
    // string standard (camera / lens) → text contains with autocomplete
    return <FacetText {...common} fieldId={f.id} suggests={f.suggests} slug={slug} />;
  }

  // custom fields
  if (f.type === FieldType.Choice) {
    return <FacetMultiselect {...common} staticOptions={f.options} />;
  }
  if (f.type === FieldType.Number) {
    return <FacetEquality {...common} inputType="number" />;
  }
  if (f.type === FieldType.Date) {
    return <FacetEquality {...common} inputType="date" />;
  }
  // FieldType.Text | FieldType.Textarea
  return <FacetText {...common} fieldId={f.id} suggests={f.suggests} slug={slug} />;
}
