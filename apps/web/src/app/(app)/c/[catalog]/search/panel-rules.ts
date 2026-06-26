import { type FilterRule, RuleOp } from "@lumio/shared";

/** Drop every rule targeting `field`; returns a new array. */
function without(rules: FilterRule[], field: string): FilterRule[] {
  return rules.filter((r) => r.field !== field);
}

export function readMultiselect(rules: FilterRule[], field: string): string[] {
  const r = rules.find((x) => x.field === field && x.op === RuleOp.in_list);
  return Array.isArray(r?.value) ? (r.value as string[]) : [];
}

export function applyMultiselect(rules: FilterRule[], field: string, values: string[]): FilterRule[] {
  const rest = without(rules, field);
  if (values.length === 0) return rest;
  return [...rest, { field, op: RuleOp.in_list, value: values }];
}

export interface RangeValue {
  min: number | null;
  max: number | null;
}

export function readRange(rules: FilterRule[], field: string): RangeValue {
  const r = rules.find((x) => x.field === field);
  if (!r) return { min: null, max: null };
  if (r.op === RuleOp.between) {
    const [a, b] = r.value as [number, number];
    return { min: a, max: b };
  }
  if (r.op === RuleOp.gte || r.op === RuleOp.gt) return { min: r.value as number, max: null };
  if (r.op === RuleOp.lte || r.op === RuleOp.lt) return { min: null, max: r.value as number };
  return { min: null, max: null };
}

export function applyRange(rules: FilterRule[], field: string, { min, max }: RangeValue): FilterRule[] {
  const rest = without(rules, field);
  if (min !== null && max !== null) return [...rest, { field, op: RuleOp.between, value: [min, max] }];
  if (min !== null) return [...rest, { field, op: RuleOp.gte, value: min }];
  if (max !== null) return [...rest, { field, op: RuleOp.lte, value: max }];
  return rest;
}

export function readToggle(rules: FilterRule[], field: string): boolean {
  return rules.some((r) => r.field === field && r.op === RuleOp.eq && r.value === true);
}

export function applyToggle(rules: FilterRule[], field: string, on: boolean): FilterRule[] {
  const rest = without(rules, field);
  return on ? [...rest, { field, op: RuleOp.eq, value: true }] : rest;
}

export interface DateRangeValue {
  from: string;
  to: string;
}

export function readDateRange(rules: FilterRule[], field: string): DateRangeValue {
  const day = (v: unknown) => (typeof v === "string" ? v.slice(0, 10) : "");
  const r = rules.find((x) => x.field === field);
  if (!r) return { from: "", to: "" };
  if (r.op === RuleOp.between) {
    const [a, b] = r.value as [string, string];
    return { from: day(a), to: day(b) };
  }
  if (r.op === RuleOp.gte || r.op === RuleOp.gt) return { from: day(r.value), to: "" };
  if (r.op === RuleOp.lte || r.op === RuleOp.lt) return { from: "", to: day(r.value) };
  return { from: "", to: "" };
}

export function applyDateRange(rules: FilterRule[], field: string, { from, to }: DateRangeValue): FilterRule[] {
  const rest = rules.filter((r) => r.field !== field);
  const start = (d: string) => `${d}T00:00:00.000Z`; // inclusive start of day (UTC)
  const end = (d: string) => `${d}T23:59:59.999Z`; // inclusive end of day (UTC)
  if (from && to) return [...rest, { field, op: RuleOp.between, value: [start(from), end(to)] }];
  if (from) return [...rest, { field, op: RuleOp.gte, value: start(from) }];
  if (to) return [...rest, { field, op: RuleOp.lte, value: end(to) }];
  return rest;
}

// Orientation is mapped from the EXIF orientation enum: values 5-8 are the 90°/270°
// rotations (camera held sideways → portrait), 1-4 are upright (landscape). This is
// best-effort — images with baked-in rotation (orientation 1 + portrait dimensions)
// won't be detected. A width/height-based signal would be more accurate but needs
// column-to-column comparison support in the query engine.
export type Orientation = "any" | "portrait" | "landscape";

export function readOrientation(rules: FilterRule[]): Orientation {
  const r = rules.find((x) => x.field === "orientation");
  if (r?.op === RuleOp.gte && r.value === 5) return "portrait";
  if (r?.op === RuleOp.lt && r.value === 5) return "landscape";
  return "any";
}

export function applyOrientation(rules: FilterRule[], o: Orientation): FilterRule[] {
  const rest = rules.filter((r) => r.field !== "orientation");
  if (o === "portrait") return [...rest, { field: "orientation", op: RuleOp.gte, value: 5 }];
  if (o === "landscape") return [...rest, { field: "orientation", op: RuleOp.lt, value: 5 }];
  return rest;
}
