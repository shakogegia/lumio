"use client";

import { useMemo, useState } from "react";
import type { FilterRule } from "@lumio/shared";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { applyMultiselect, readMultiselect } from "./panel-rules";

export function FacetMultiselect({
  label,
  fieldKey,
  staticOptions,
  rules,
  onRules,
}: {
  label: string;
  fieldKey: string; // canonical rule field key (e.g. "cameraModel")
  staticOptions: string[]; // choice-field options from schema
  rules: FilterRule[];
  onRules: (next: FilterRule[]) => void;
}) {
  const [query, setQuery] = useState("");
  const selected = readMultiselect(rules, fieldKey);

  const shown = useMemo(
    () => staticOptions.filter((v) => v.toLowerCase().includes(query.toLowerCase())),
    [staticOptions, query],
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
          <label key={v} className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={selected.includes(v)}
              onCheckedChange={(on) => toggle(v, on === true)}
            />
            <span className="flex-1 truncate">{v}</span>
          </label>
        ))}
        {shown.length === 0 && <span className="text-xs text-muted-foreground">No values</span>}
      </div>
    </section>
  );
}
