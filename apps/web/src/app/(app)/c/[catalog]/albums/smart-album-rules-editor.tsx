"use client";

import { useState } from "react";
import {
  MatchType,
  RuleOp,
  FieldType,
  FieldKind,
  buildSearchRegistry,
  type FilterRule,
  type MetadataFieldDef,
} from "@lumio/shared";
import { GripVertical, X, Plus } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useCatalog } from "@/components/providers/catalog-context";
import { useCatalogMetadataSchema } from "@/features/lightbox/use-metadata-schema";
import { MetadataValueInput } from "@/components/metadata/metadata-value-input";

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

/** Curated op sets per field type / kind. */
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
  // custom Number/Date
  return [RuleOp.eq, RuleOp.exists, RuleOp.not_exists];
}

// ─── Value coercion ─────────────────────────────────────────────────────────

/**
 * Coerce a raw string (or pair) from the widget into the typed FilterRule.value.
 * Standard Number → JS number; Standard Date → ISO string; custom Number/Date → string.
 */
function coerceValue(
  field: MetadataFieldDef,
  op: RuleOp,
  raw: string | [string, string],
): FilterRule["value"] {
  if (NO_VALUE_OPS.has(op)) return undefined;

  const isStdNum =
    field.kind === FieldKind.Standard && field.type === FieldType.Number;

  if (op === RuleOp.between && Array.isArray(raw)) {
    const [a, b] = raw as [string, string];
    if (isStdNum) {
      const na = Number(a);
      const nb = Number(b);
      return Number.isFinite(na) && Number.isFinite(nb) ? [na, nb] : undefined;
    }
    return [a, b]; // date strings
  }

  const s = raw as string;
  if (isStdNum) {
    const n = Number(s);
    return Number.isFinite(n) ? n : undefined;
  }
  return s;
}

// ─── Completeness helper (exported) ─────────────────────────────────────────

/**
 * True iff `rules.length > 0` and every rule is fully filled-in.
 * - no-value ops (exists / not_exists) → always complete
 * - between → both tuple parts non-empty
 * - all others → value must be a non-empty string or finite number
 */
export function rulesComplete(rules: FilterRule[]): boolean {
  if (rules.length === 0) return false;
  return rules.every((r) => {
    if (NO_VALUE_OPS.has(r.op)) return true;
    if (r.value === undefined || r.value === null) return false;
    if (Array.isArray(r.value)) {
      // between tuple — both parts must be non-empty
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

// ─── Value widget ────────────────────────────────────────────────────────────

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
        className="h-8 w-24 rounded-md border border-input bg-background px-2 py-1 text-sm outline-none focus:border-ring"
      />
      <span className="text-xs text-muted-foreground">–</span>
      <input
        type={inputType}
        value={tuple[1]}
        onChange={(e) => onChange([tuple[0], e.target.value])}
        className="h-8 w-24 rounded-md border border-input bg-background px-2 py-1 text-sm outline-none focus:border-ring"
      />
    </div>
  );
}

function ValueWidget({
  slug,
  field,
  op,
  value,
  onChange,
}: {
  slug: string;
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
        onChange={(pair) => {
          onChange(coerceValue(field, op, pair));
        }}
      />
    );
  }

  // Single-value ops
  const strValue = value === undefined || value === null ? "" : String(value);

  if (field.type === FieldType.Choice) {
    return (
      <MetadataValueInput
        slug={slug}
        fieldId={field.id}
        type={field.type}
        options={field.options}
        suggests={field.suggests}
        value={strValue}
        onChange={(v) => onChange(coerceValue(field, op, v))}
      />
    );
  }

  if (field.type === FieldType.Text || field.type === FieldType.Textarea) {
    return (
      <MetadataValueInput
        slug={slug}
        fieldId={field.id}
        type={field.type}
        options={field.options}
        suggests={field.suggests}
        value={strValue}
        onChange={(v) => onChange(coerceValue(field, op, v))}
      />
    );
  }

  if (field.type === FieldType.Number) {
    return (
      <input
        type="number"
        value={strValue}
        onChange={(e) => onChange(coerceValue(field, op, e.target.value))}
        className="h-8 w-28 rounded-md border border-input bg-background px-2 py-1 text-sm outline-none focus:border-ring"
      />
    );
  }

  if (field.type === FieldType.Date) {
    return (
      <input
        type="date"
        value={strValue}
        onChange={(e) => onChange(coerceValue(field, op, e.target.value))}
        className="h-8 w-36 rounded-md border border-input bg-background px-2 py-1 text-sm outline-none focus:border-ring"
      />
    );
  }

  return null;
}

// ─── Rule row ────────────────────────────────────────────────────────────────

function RuleRow({
  rule,
  index,
  allFields,
  slug,
  isDragging,
  onDragStart,
  onDragOver,
  onDragEnd,
  onChange,
  onRemove,
}: {
  rule: FilterRule;
  index: number;
  allFields: MetadataFieldDef[];
  slug: string;
  isDragging: boolean;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragEnd: () => void;
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
    const nextOps = opsForField(nextField);
    const nextOp = nextOps[0] ?? RuleOp.eq;
    onChange({ field: key, op: nextOp, value: undefined });
  }

  function handleOpChange(op: RuleOp) {
    // Clear value when switching to/from no-value ops or between
    const prevNoVal = NO_VALUE_OPS.has(rule.op);
    const nextNoVal = NO_VALUE_OPS.has(op);
    const prevBetween = rule.op === RuleOp.between;
    const nextBetween = op === RuleOp.between;
    const resetValue =
      prevNoVal !== nextNoVal || prevBetween !== nextBetween;
    onChange({ ...rule, op, value: resetValue ? undefined : rule.value });
  }

  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      className={cn(
        "flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5",
        isDragging && "opacity-50",
      )}
    >
      {/* Grip */}
      <span className="cursor-grab text-muted-foreground/60 active:cursor-grabbing shrink-0">
        <GripVertical className="size-4" aria-hidden />
      </span>

      {/* Field selector */}
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

      {/* Operator selector */}
      <Select value={currentOp} onValueChange={(v) => handleOpChange(v as RuleOp)}>
        <SelectTrigger size="sm" className="w-28 shrink-0">
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

      {/* Value widget */}
      <div className="flex-1 min-w-0">
        <ValueWidget
          slug={slug}
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

  // Build the registry and flat field list from the schema
  const registry = buildSearchRegistry(schema ?? []);
  const allFields: MetadataFieldDef[] = (schema ?? []).flatMap((g) =>
    g.fields.filter((f) => f.enabled && registry.has(f.key)),
  );

  // DnD state — which row index is being dragged
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  // ── Loading / empty states ──
  if (schema === undefined) return null;

  if (allFields.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        This catalog has no metadata fields to filter on. Add fields in Settings
        → Metadata first.
      </p>
    );
  }

  // ── Helpers ──
  function setRules(next: FilterRule[]) {
    onChange({ ...value, rules: next });
  }

  function addRule() {
    const f = allFields[0]!;
    const ops = opsForField(f);
    const op = ops[0] ?? RuleOp.eq;
    setRules([...value.rules, { field: f.key, op, value: undefined }]);
  }

  function removeRule(i: number) {
    setRules(value.rules.filter((_, idx) => idx !== i));
  }

  function updateRule(i: number, next: FilterRule) {
    setRules(value.rules.map((r, idx) => (idx === i ? next : r)));
  }

  // DnD handlers — reorder a local copy while dragging; commit on drop
  function handleDragOver(e: React.DragEvent, targetIdx: number) {
    e.preventDefault();
    if (dragIdx === null || dragIdx === targetIdx) return;
    const next = [...value.rules];
    const [moved] = next.splice(dragIdx, 1);
    next.splice(targetIdx, 0, moved!);
    setDragIdx(targetIdx);
    setRules(next);
  }

  function handleDragEnd() {
    setDragIdx(null);
  }

  return (
    <div className="space-y-3">
      {/* Header: match selector */}
      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted-foreground">Match</span>
        <Select
          value={value.match}
          onValueChange={(v) =>
            onChange({ ...value, match: v as MatchType })
          }
        >
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

      {/* Rule rows */}
      {value.rules.length > 0 && (
        <div className="space-y-1.5">
          {value.rules.map((rule, i) => (
            <RuleRow
              key={i}
              rule={rule}
              index={i}
              allFields={allFields}
              slug={slug}
              isDragging={dragIdx === i}
              onDragStart={() => setDragIdx(i)}
              onDragOver={(e) => handleDragOver(e, i)}
              onDragEnd={handleDragEnd}
              onChange={(next) => updateRule(i, next)}
              onRemove={() => removeRule(i)}
            />
          ))}
        </div>
      )}

      {/* Add rule */}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={addRule}
        className="gap-1.5"
      >
        <Plus className="size-3.5" aria-hidden />
        Add rule
      </Button>
    </div>
  );
}
