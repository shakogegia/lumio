import { RuleOp } from "./enums.js";
import { type FieldDef, FieldType, type FilterRule, type FilterValue, resolveField } from "./filters.js";

// Match whitespace-separated tokens, keeping a quoted value (which may contain
// spaces) attached to its `field:` prefix, e.g. `camera:"Sony A7 IV"`.
const TOKEN_RE = /\S+:"[^"]*"|\S+/g;

function stripQuotes(s: string): string {
  return s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s;
}

// Plain decimal only — reject hex (0x1F→31), scientific (1e3→1000), and other
// forms Number() silently accepts but a user wouldn't expect in a search box.
const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

function toNumber(v: string): number | undefined {
  if (!DECIMAL_RE.test(v)) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

const COMPARISON_OPS = new Set<RuleOp>([RuleOp.gt, RuleOp.gte, RuleOp.lt, RuleOp.lte, RuleOp.between]);

/** Coerce a raw string to the value type the field expects, or undefined if invalid. */
function coerceScalar(def: FieldDef, op: RuleOp, raw: string): FilterValue | undefined {
  const v = stripQuotes(raw);
  if (v === "") return undefined;
  if (def.type === FieldType.number) {
    return toNumber(v);
  }
  if (def.type === FieldType.date) {
    const t = Date.parse(v);
    return Number.isNaN(t) ? undefined : new Date(t).toISOString();
  }
  if (def.type === FieldType.bool) {
    if (/^(true|1|yes)$/i.test(v)) return true;
    if (/^(false|0|no)$/i.test(v)) return false;
    return undefined;
  }
  // string (string column, date, or generic JSON): numeric-coerce only for
  // comparison ops so generic numeric EXIF keys compare numerically.
  if (def.type === FieldType.string && COMPARISON_OPS.has(op)) {
    const n = toNumber(v);
    if (n !== undefined) return n;
  }
  return v;
}

/** Parse one `field:...` token into a rule, or null if it isn't a valid filter token. */
function tokenToRule(token: string): FilterRule | null {
  const colon = token.indexOf(":");
  if (colon <= 0) return null;
  const fieldPart = token.slice(0, colon);
  const valuePart = token.slice(colon + 1);
  if (valuePart === "") return null;

  const def = resolveField(fieldPart);
  if (def.storage.kind === "album") return null; // albums use @album chips

  let op: RuleOp;
  let raw: string;
  const unquoted = stripQuotes(valuePart) === valuePart; // not a "quoted" value
  if (valuePart === "?") {
    op = RuleOp.exists;
    raw = "";
  } else if (valuePart === "!?") {
    op = RuleOp.not_exists;
    raw = "";
  } else if (unquoted && valuePart.startsWith(">=")) {
    op = RuleOp.gte;
    raw = valuePart.slice(2);
  } else if (unquoted && valuePart.startsWith("<=")) {
    op = RuleOp.lte;
    raw = valuePart.slice(2);
  } else if (unquoted && valuePart.startsWith(">")) {
    op = RuleOp.gt;
    raw = valuePart.slice(1);
  } else if (unquoted && valuePart.startsWith("<")) {
    op = RuleOp.lt;
    raw = valuePart.slice(1);
  } else if (unquoted && valuePart.startsWith("=")) {
    op = RuleOp.eq;
    raw = valuePart.slice(1);
  } else if (unquoted && valuePart.includes("..")) {
    op = RuleOp.between;
    raw = valuePart;
  } else {
    op = def.type === FieldType.string ? RuleOp.contains : RuleOp.eq;
    raw = valuePart;
  }

  if (!def.ops.includes(op)) return null;

  if (op === RuleOp.exists || op === RuleOp.not_exists) {
    return { field: def.key, op };
  }
  if (op === RuleOp.between) {
    const parts = raw.split("..");
    if (parts.length !== 2) return null;
    const va = coerceScalar(def, op, parts[0] ?? "");
    const vb = coerceScalar(def, op, parts[1] ?? "");
    if (va === undefined || vb === undefined) return null;
    return { field: def.key, op, value: [va, vb] as [number, number] | [string, string] };
  }
  const value = coerceScalar(def, op, raw);
  if (value === undefined) return null;
  return { field: def.key, op, value };
}

// ──────────────────────────────────────────────────────────────────────────────
// ruleToToken + formatRuleLabel
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Split a search box's raw text into structured EXIF filter rules + the leftover
 * free text (the filename query). Tokens that don't resolve to a valid rule are
 * kept verbatim in the free text.
 */
export function parseFilterTokens(text: string): { rules: FilterRule[]; text: string } {
  const rules: FilterRule[] = [];
  const leftover: string[] = [];
  for (const token of text.match(TOKEN_RE) ?? []) {
    const rule = tokenToRule(token);
    if (rule) rules.push(rule);
    else leftover.push(token);
  }
  return { rules, text: leftover.join(" ").trim() };
}

const OP_PREFIX: Partial<Record<RuleOp, string>> = {
  [RuleOp.gt]: ">",
  [RuleOp.gte]: ">=",
  [RuleOp.lt]: "<",
  [RuleOp.lte]: "<=",
  [RuleOp.eq]: "=",
};

function quoteIfNeeded(s: string): string {
  return /\s/.test(s) ? `"${s}"` : s;
}

/** Inverse of parseFilterTokens for a single rule (used to replay recent searches).
 *  Only ops with a typed-token form are supported; others throw so a future
 *  programmatic caller adds grammar instead of silently corrupting a recalled search. */
export function ruleToToken(rule: FilterRule): string {
  const f = rule.field;
  switch (rule.op) {
    case RuleOp.exists:
      return `${f}:?`;
    case RuleOp.not_exists:
      return `${f}:!?`;
    case RuleOp.between: {
      const [a, b] = rule.value as [unknown, unknown];
      return `${f}:${a}..${b}`;
    }
    case RuleOp.contains:
      return `${f}:${quoteIfNeeded(String(rule.value))}`;
    case RuleOp.eq:
    case RuleOp.gt:
    case RuleOp.gte:
    case RuleOp.lt:
    case RuleOp.lte:
      return `${f}:${OP_PREFIX[rule.op] ?? ""}${quoteIfNeeded(String(rule.value))}`;
    default:
      throw new Error(`ruleToToken: no token form for op "${rule.op}"`);
  }
}

/** Human-readable label for a rule chip, e.g. "ISO ≥ 800", "Camera contains Sony". */
export function formatRuleLabel(rule: FilterRule): string {
  const name = resolveField(rule.field).label;
  switch (rule.op) {
    case RuleOp.exists:
      return `${name} is set`;
    case RuleOp.not_exists:
      return `${name} not set`;
    case RuleOp.last_30_days:
      return `${name}: last 30 days`;
    case RuleOp.between: {
      const [a, b] = rule.value as [unknown, unknown];
      return `${name}: ${a}–${b}`;
    }
    case RuleOp.contains:
      return `${name} contains ${String(rule.value)}`;
    case RuleOp.ne:
      return `${name} ≠ ${String(rule.value)}`;
    case RuleOp.gt:
      return `${name} > ${String(rule.value)}`;
    case RuleOp.gte:
      return `${name} ≥ ${String(rule.value)}`;
    case RuleOp.lt:
      return `${name} < ${String(rule.value)}`;
    case RuleOp.lte:
      return `${name} ≤ ${String(rule.value)}`;
    case RuleOp.in_list:
      return `${name} is ${(rule.value as string[]).join(" or ")}`;
    case RuleOp.not_in_list:
      return `${name} is not ${(rule.value as string[]).join(" or ")}`;
    default:
      return `${name} = ${String(rule.value)}`;
  }
}
