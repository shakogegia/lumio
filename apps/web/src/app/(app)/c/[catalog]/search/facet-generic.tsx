"use client";

import { useState } from "react";
import { type FilterRule, ValueType, RuleOp, resolveField } from "@lumio/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useExifFields } from "./use-exif-discovery";

const CURATED = ["cameraModel", "lensModel", "iso", "aperture", "focalLength", "exposureTime", "takenAt", "hasGps"];
const NO_VALUE = new Set<RuleOp>([RuleOp.exists, RuleOp.not_exists, RuleOp.last_30_days]);
// in-list (multiselect's job) and between (the range facets' job) need special widgets, not a single value.
const HIDE_OPS = new Set<RuleOp>([RuleOp.in_list, RuleOp.not_in_list, RuleOp.between]);

export function FacetGeneric({ rules, onRules }: { rules: FilterRule[]; onRules: (next: FilterRule[]) => void }) {
  const fields = useExifFields(true);
  const options = Array.from(new Set([...CURATED, ...fields.map((f) => `exif.${f}`)]));
  const [field, setField] = useState(options[0] ?? "cameraModel");
  const def = resolveField(field);
  const ops = def.ops.filter((o) => !HIDE_OPS.has(o));
  const [op, setOp] = useState<RuleOp>(ops[0] ?? RuleOp.eq);
  const [value, setValue] = useState("");

  function add() {
    if (NO_VALUE.has(op)) {
      onRules([...rules, { field, op }]);
      return;
    }
    let v: FilterRule["value"];
    if (def.type === ValueType.number) {
      const n = Number(value);
      if (!Number.isFinite(n)) return;
      v = n;
    } else if (def.type === ValueType.bool) {
      v = value === "true" || value === "1" || value === "yes";
    } else {
      if (value === "") return;
      v = value;
    }
    onRules([...rules, { field, op, value: v }]);
    setValue("");
  }

  return (
    <section>
      <h3 className="mb-1 text-xs font-medium text-muted-foreground">Add filter</h3>
      <div className="flex flex-col gap-2">
        <select
          className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
          value={field}
          onChange={(e) => {
            const f = e.target.value;
            setField(f);
            const next = resolveField(f).ops.filter((o) => !HIDE_OPS.has(o));
            setOp(next[0] ?? RuleOp.eq);
          }}
        >
          {options.map((f) => (
            <option key={f} value={f}>
              {resolveField(f).label}
            </option>
          ))}
        </select>
        <div className="flex gap-2">
          <select
            className="h-8 rounded-md border border-input bg-transparent px-2 text-sm"
            value={op}
            onChange={(e) => setOp(e.target.value as RuleOp)}
          >
            {ops.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
          {!NO_VALUE.has(op) && (
            <Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="value" className="h-8 flex-1" />
          )}
          <Button size="sm" onClick={add}>
            Add
          </Button>
        </div>
      </div>
    </section>
  );
}
