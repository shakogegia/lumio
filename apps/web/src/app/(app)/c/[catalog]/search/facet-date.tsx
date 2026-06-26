"use client";

import type { FilterRule } from "@lumio/shared";
import { Input } from "@/components/ui/input";
import { applyDateRange, readDateRange } from "./panel-rules";

export function FacetDate({
  label,
  fieldKey,
  rules,
  onRules,
}: {
  label: string;
  fieldKey: string;
  rules: FilterRule[];
  onRules: (next: FilterRule[]) => void;
}) {
  const { from, to } = readDateRange(rules, fieldKey);
  return (
    <section>
      <h3 className="mb-1 text-xs font-medium text-muted-foreground">{label}</h3>
      <div className="flex items-center gap-2">
        <Input type="date" value={from} onChange={(e) => onRules(applyDateRange(rules, fieldKey, { from: e.target.value, to }))} className="h-8" />
        <span className="text-xs text-muted-foreground">to</span>
        <Input type="date" value={to} onChange={(e) => onRules(applyDateRange(rules, fieldKey, { from, to: e.target.value }))} className="h-8" />
      </div>
    </section>
  );
}
