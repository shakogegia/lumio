"use client";

import {
  MatchType,
  RuleOp,
  FieldType,
  FieldKind,
  buildSearchRegistry,
  type FilterRule,
  type MetadataFieldDef,
} from "@lumio/shared";
import { X, Plus } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useCatalog } from "@/components/providers/catalog-context";
import { useCatalogMetadataSchema } from "@/features/lightbox/use-metadata-schema";

// ─── Public contract ────────────────────────────────────────────────────────

export type SmartRulesValue = { match: MatchType; rules: FilterRule[] };

// ─── Op configuration ───────────────────────────────────────────────────────

const OP_LABELS: Partial<Record<RuleOp, string>> = {
  [RuleOp.eq]: "is",
  [RuleOp.contains]: "contains",
  [RuleOp.gte]: "≥",
  [RuleOp.lte]: "≤",
  [RuleOp.between]: "between",
  [RuleOp.exists]: "is set",
  [RuleOp.not_exists]: "is not set",
};

const NO_VALUE_OPS = new Set<RuleOp>([RuleOp.exists, RuleOp.not_exists]);

/** Curated op sets per field type / kind. (Order is irrelevant for all/any, so
 *  multiple values = multiple rows + Match "any" — no list op / no reordering.) */
function opsForField(field: MetadataFieldDef): RuleOp[] {
  if (field.type === FieldType.Choice) {
    return [RuleOp.eq, RuleOp.exists, RuleOp.not_exists];
  }
  if (field.type === FieldType.Text || field.type === FieldType.Textarea) {
    return [RuleOp.contains, RuleOp.eq, RuleOp.exists, RuleOp.not_exists];
  }
  // Number or Date
  if (field.kind === FieldKind.Standard) {
    return [RuleOp.eq, RuleOp.gte, RuleOp.lte, RuleOp.between, RuleOp.exists, RuleOp.not_exists];
  }
  // custom Number/Date (text-stored): no range
  return [RuleOp.eq, RuleOp.exists, RuleOp.not_exists];
}

// ─── Value coercion ─────────────────────────────────────────────────────────

/** Coerce the widget's raw string(s) into the typed FilterRule.value.
 *  Standard Number → JS number; everything else → string(s). */
function coerceValue(
  field: MetadataFieldDef,
  op: RuleOp,
  raw: string | [string, string],
): FilterRule["value"] {
  if (NO_VALUE_OPS.has(op)) return undefined;
  const isStdNum = field.kind === FieldKind.Standard && field.type === FieldType.Number;

  if (op === RuleOp.between && Array.isArray(raw)) {
    const [a, b] = raw;
    if (isStdNum) {
      const na = Number(a);
      const nb = Number(b);
      return Number.isFinite(na) && Number.isFinite(nb) ? [na, nb] : undefined;
    }
    return [a, b];
  }

  const s = raw as string;
  if (isStdNum) {
    const n = Number(s);
    return Number.isFinite(n) ? n : undefined;
  }
  return s;
}

// ─── Completeness helper (exported; gates the dialogs' submit) ───────────────

export function rulesComplete(rules: FilterRule[]): boolean {
  if (rules.length === 0) return false;
  return rules.every((r) => {
    if (NO_VALUE_OPS.has(r.op)) return true;
    if (r.value === undefined || r.value === null) return false;
    if (Array.isArray(r.value)) {
      return (
        r.value.length === 2 &&
        r.value[0] !== "" &&
        r.value[0] !== undefined &&
        r.value[1] !== "" &&
        r.value[1] !== undefined
      );
    }
    if (typeof r.value === "number") return Number.isFinite(r.value);
    if (typeof r.value === "string") return r.value.trim() !== "";
    return false;
  });
}

// ─── Value widgets (all flex to fill the row) ────────────────────────────────

const INPUT_CLS =
  "h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 py-1 text-sm outline-none focus:border-ring";

function BetweenWidget({
  field,
  value,
  onChange,
}: {
  field: MetadataFieldDef;
  value: FilterRule["value"];
  onChange: (next: [string, string]) => void;
}) {
  const tuple =
    Array.isArray(value) && value.length === 2
      ? ([String(value[0]), String(value[1])] as [string, string])
      : (["", ""] as [string, string]);
  const inputType = field.type === FieldType.Date ? "date" : "number";
  return (
    <div className="flex items-center gap-1">
      <input
        type={inputType}
        value={tuple[0]}
        onChange={(e) => onChange([e.target.value, tuple[1]])}
        className={INPUT_CLS}
      />
      <span className="shrink-0 text-xs text-muted-foreground">–</span>
      <input
        type={inputType}
        value={tuple[1]}
        onChange={(e) => onChange([tuple[0], e.target.value])}
        className={INPUT_CLS}
      />
    </div>
  );
}

function ValueWidget({
  field,
  op,
  value,
  onChange,
}: {
  field: MetadataFieldDef;
  op: RuleOp;
  value: FilterRule["value"];
  onChange: (next: FilterRule["value"]) => void;
}) {
  if (NO_VALUE_OPS.has(op)) return null;

  if (op === RuleOp.between) {
    return (
      <BetweenWidget
        field={field}
        value={value}
        onChange={(pair) => onChange(coerceValue(field, op, pair))}
      />
    );
  }

  const strValue = value === undefined || value === null ? "" : String(value);

  if (field.type === FieldType.Choice) {
    return (
      <Select value={strValue || undefined} onValueChange={(v) => onChange(coerceValue(field, op, v))}>
        <SelectTrigger size="sm" className="w-full">
          <SelectValue placeholder="Select…" />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {field.options.map((o) => (
              <SelectItem key={o} value={o}>
                {o}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    );
  }

  const inputType =
    field.type === FieldType.Number ? "number" : field.type === FieldType.Date ? "date" : "text";
  return (
    <input
      type={inputType}
      value={strValue}
      placeholder="value"
      onChange={(e) => onChange(coerceValue(field, op, e.target.value))}
      className={INPUT_CLS}
    />
  );
}

// ─── Rule row ────────────────────────────────────────────────────────────────

function RuleRow({
  rule,
  index,
  allFields,
  onChange,
  onRemove,
}: {
  rule: FilterRule;
  index: number;
  allFields: MetadataFieldDef[];
  onChange: (next: FilterRule) => void;
  onRemove: () => void;
}) {
  const field = allFields.find((f) => f.key === rule.field) ?? allFields[0];
  if (!field) return null;

  const ops = opsForField(field);
  const currentOp = ops.includes(rule.op) ? rule.op : (ops[0] ?? RuleOp.eq);

  function handleFieldChange(key: string) {
    const nextField = allFields.find((f) => f.key === key);
    if (!nextField) return;
    const nextOp = opsForField(nextField)[0] ?? RuleOp.eq;
    onChange({ field: key, op: nextOp, value: undefined });
  }

  function handleOpChange(op: RuleOp) {
    const resetValue =
      NO_VALUE_OPS.has(rule.op) !== NO_VALUE_OPS.has(op) ||
      (rule.op === RuleOp.between) !== (op === RuleOp.between);
    onChange({ ...rule, op, value: resetValue ? undefined : rule.value });
  }

  return (
    <div className="flex items-center gap-2">
      {/* Field */}
      <Select value={field.key} onValueChange={handleFieldChange}>
        <SelectTrigger size="sm" className="w-32 shrink-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {allFields.map((f) => (
              <SelectItem key={f.key} value={f.key}>
                {f.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>

      {/* Operator */}
      <Select value={currentOp} onValueChange={(v) => handleOpChange(v as RuleOp)}>
        <SelectTrigger size="sm" className="w-24 shrink-0">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {ops.map((op) => (
              <SelectItem key={op} value={op}>
                {OP_LABELS[op] ?? op}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>

      {/* Value */}
      <div className="min-w-0 flex-1">
        <ValueWidget
          field={field}
          op={currentOp}
          value={rule.value}
          onChange={(next) => onChange({ ...rule, op: currentOp, value: next })}
        />
      </div>

      {/* Remove */}
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={onRemove}
        aria-label={`Remove rule ${index + 1}`}
        className="shrink-0 text-muted-foreground hover:text-foreground"
      >
        <X className="size-4" aria-hidden />
      </Button>
    </div>
  );
}

// ─── Main editor ─────────────────────────────────────────────────────────────

export function SmartAlbumRulesEditor({
  value,
  onChange,
}: {
  value: SmartRulesValue;
  onChange: (next: SmartRulesValue) => void;
}) {
  const { slug } = useCatalog();
  const schema = useCatalogMetadataSchema(slug);

  const registry = buildSearchRegistry(schema ?? []);
  const allFields: MetadataFieldDef[] = (schema ?? []).flatMap((g) =>
    g.fields.filter((f) => f.enabled && registry.has(f.key)),
  );

  if (schema === undefined) return null; // loading

  if (allFields.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        This catalog has no metadata fields to filter on. Add fields in Settings → Metadata first.
      </p>
    );
  }

  function setRules(next: FilterRule[]) {
    onChange({ ...value, rules: next });
  }

  function addRule() {
    const f = allFields[0]!;
    const op = opsForField(f)[0] ?? RuleOp.eq;
    setRules([...value.rules, { field: f.key, op, value: undefined }]);
  }

  return (
    <div className="space-y-3">
      {/* Match all/any */}
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Match</span>
        <Select value={value.match} onValueChange={(v) => onChange({ ...value, match: v as MatchType })}>
          <SelectTrigger size="sm" className="w-20">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value={MatchType.all}>all</SelectItem>
              <SelectItem value={MatchType.any}>any</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        <span className="text-muted-foreground">of the rules</span>
      </div>

      {/* Rules */}
      {value.rules.length > 0 && (
        <div className="space-y-1.5">
          {value.rules.map((rule, i) => (
            <RuleRow
              key={i}
              rule={rule}
              index={i}
              allFields={allFields}
              onChange={(next) => setRules(value.rules.map((r, idx) => (idx === i ? next : r)))}
              onRemove={() => setRules(value.rules.filter((_, idx) => idx !== i))}
            />
          ))}
        </div>
      )}

      <Button type="button" variant="outline" size="sm" onClick={addRule} className="gap-1.5">
        <Plus className="size-3.5" aria-hidden />
        Add rule
      </Button>
    </div>
  );
}
