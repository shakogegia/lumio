"use client";

import { useMemo, useState } from "react";
import type { FilterRule } from "@lumio/shared";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { useExifValues } from "./use-exif-discovery";
import { applyMultiselect, readMultiselect } from "./panel-rules";

export function FacetMultiselect({
  label,
  field,
  fieldKey,
  rules,
  onRules,
}: {
  label: string;
  field: string; // discovery field name (e.g. "camera")
  fieldKey: string; // canonical rule field key (e.g. "cameraModel")
  rules: FilterRule[];
  onRules: (next: FilterRule[]) => void;
}) {
  const values = useExifValues(field);
  const [query, setQuery] = useState("");
  const selected = readMultiselect(rules, fieldKey);
  const shown = useMemo(
    () => values.filter((v) => v.value.toLowerCase().includes(query.toLowerCase())),
    [values, query],
  );
  function toggle(value: string, on: boolean) {
    const next = on ? [...selected, value] : selected.filter((v) => v !== value);
    onRules(applyMultiselect(rules, fieldKey, next));
  }
  return (
    <section>
      <h3 className="mb-1 text-xs font-medium text-muted-foreground">{label}</h3>
      <Input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={`Filter ${label.toLowerCase()}…`}
        className="mb-2 h-8"
      />
      <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
        {shown.map((v) => (
          <label key={v.value} className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={selected.includes(v.value)}
              onCheckedChange={(on) => toggle(v.value, on === true)}
            />
            <span className="flex-1 truncate">{v.value}</span>
            <span className="text-xs text-muted-foreground">{v.count.toLocaleString()}</span>
          </label>
        ))}
        {shown.length === 0 && <span className="text-xs text-muted-foreground">No values</span>}
      </div>
    </section>
  );
}
