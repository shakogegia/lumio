"use client";

import type { FilterRule } from "@lumio/shared";
import { RuleOp } from "@lumio/shared";

export function FacetEquality({
  label,
  fieldKey,
  inputType,
  rules,
  onRules,
}: {
  label: string;
  fieldKey: string;
  inputType: "number" | "date";
  rules: FilterRule[];
  onRules: (next: FilterRule[]) => void;
}) {
  const current = rules.find((r) => r.field === fieldKey && r.op === RuleOp.eq);
  const rawValue = current !== undefined ? String(current.value) : "";

  function commit(raw: string) {
    const rest = rules.filter((r) => !(r.field === fieldKey && r.op === RuleOp.eq));
    if (raw === "") {
      onRules(rest);
      return;
    }
    if (inputType === "number") {
      const num = Number(raw);
      if (!Number.isFinite(num)) return;
      onRules([...rest, { field: fieldKey, op: RuleOp.eq, value: num }]);
    } else {
      // type="date" yields YYYY-MM-DD
      onRules([...rest, { field: fieldKey, op: RuleOp.eq, value: raw }]);
    }
  }

  return (
    <section>
      <h3 className="mb-1 text-xs font-medium text-muted-foreground">{label}</h3>
      <input
        type={inputType}
        value={rawValue}
        onChange={(e) => commit(e.target.value)}
        className="h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-sm outline-none focus:border-ring"
      />
    </section>
  );
}
