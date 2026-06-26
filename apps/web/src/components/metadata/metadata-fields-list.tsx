"use client";

import type { ReactNode } from "react";
import type { MetadataFieldDef, MetadataSchema } from "@lumio/shared";

/**
 * The shared grouped layout for custom metadata fields — group headers with a
 * `label : value` row per field. The caller supplies the value slot (an editable
 * input on the upload panel, a per-photo editor or skeleton in the Info tab), so
 * the structure stays identical everywhere it's shown.
 */
export function MetadataFieldsList({
  groups,
  renderValue,
}: {
  groups: MetadataSchema;
  renderValue: (field: MetadataFieldDef) => ReactNode;
}) {
  return (
    <div className="space-y-3">
      {groups.map((group) => (
        <div key={group.id} className="space-y-1">
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {group.label}
          </p>
          {group.fields.map((field) => (
            <div key={field.id} className="flex items-center justify-between gap-3">
              <span className="shrink-0 text-sm text-muted-foreground">{field.label}</span>
              {renderValue(field)}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
