"use client";

import { useState } from "react";
import { type FilterRule, RuleOp } from "@lumio/shared";
import { useMetadataValues } from "./use-metadata-values";

export function FacetText({
  label,
  fieldKey,
  fieldId,
  suggests,
  slug,
  rules,
  onRules,
}: {
  label: string;
  fieldKey: string;
  fieldId: string;
  suggests: boolean;
  slug: string;
  rules: FilterRule[];
  onRules: (next: FilterRule[]) => void;
}) {
  const ruleValue =
    (rules.find((r) => r.field === fieldKey && r.op === RuleOp.contains)?.value as string) ?? "";
  const [value, setValue] = useState<string>(ruleValue);
  const [syncedRuleValue, setSyncedRuleValue] = useState<string>(ruleValue);
  const [open, setOpen] = useState(false);

  // Track the rule changing from OUTSIDE this input (chip removed in the search
  // box, a saved search recalled). Idiomatic React state-sync during render (the
  // repo bans setState-in-effect) — stops the input going stale and stops a
  // removed filter from resurrecting on the next blur.
  if (ruleValue !== syncedRuleValue) {
    setSyncedRuleValue(ruleValue);
    setValue(ruleValue);
  }

  const suggestions = useMetadataValues(slug, suggests ? fieldId : null, value);
  const matches = suggestions.filter((s) => s !== value).slice(0, 8);

  function commit(next: string) {
    const without = rules.filter((r) => !(r.field === fieldKey && r.op === RuleOp.contains));
    onRules(next.trim() ? [...without, { field: fieldKey, op: RuleOp.contains, value: next.trim() }] : without);
  }

  function pick(s: string) {
    setValue(s);
    commit(s);
    setOpen(false);
  }

  return (
    <section>
      <h3 className="mb-1 text-xs font-medium text-muted-foreground">{label}</h3>
      <div className="relative">
        <input
          type="text"
          value={value}
          onChange={(e) => { setValue(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => { setTimeout(() => { setOpen(false); commit(value); }, 120); }}
          placeholder="contains…"
          className="h-8 w-full rounded-md border border-input bg-background px-2 py-1 text-sm outline-none focus:border-ring"
        />
        {open && suggests && matches.length > 0 && (
          <ul className="absolute right-0 z-30 mt-1 max-h-48 w-48 overflow-auto rounded-md border border-border bg-popover p-1 text-sm shadow-md">
            {matches.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(s)}
                  className="block w-full truncate rounded px-2 py-1 text-left hover:bg-accent hover:text-accent-foreground"
                >
                  {s}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
