"use client";

import type { FilterRule } from "@lumio/shared";
import { Input } from "@/components/ui/input";
import { applyRange, readRange } from "./panel-rules";

export function FacetRange({
  label,
  fieldKey,
  step,
  rules,
  onRules,
}: {
  label: string;
  fieldKey: string;
  step?: string;
  rules: FilterRule[];
  onRules: (next: FilterRule[]) => void;
}) {
  const { min, max } = readRange(rules, fieldKey);
  function set(side: "min" | "max", raw: string) {
    const parsed = raw === "" ? null : Number(raw);
    const value = parsed !== null && Number.isFinite(parsed) ? parsed : null;
    const nextRange = side === "min" ? { min: value, max } : { min, max: value };
    onRules(applyRange(rules, fieldKey, nextRange));
  }
  return (
    <section>
      <h3 className="mb-1 text-xs font-medium text-muted-foreground">{label}</h3>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          inputMode="decimal"
          step={step}
          value={min ?? ""}
          onChange={(e) => set("min", e.target.value)}
          placeholder="min"
          className="h-8"
        />
        <span className="text-xs text-muted-foreground">to</span>
        <Input
          type="number"
          inputMode="decimal"
          step={step}
          value={max ?? ""}
          onChange={(e) => set("max", e.target.value)}
          placeholder="max"
          className="h-8"
        />
      </div>
    </section>
  );
}
