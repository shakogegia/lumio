import { Prisma } from "@prisma/client";
import {
  FieldType,
  type FieldDef,
  type FilterRule,
  type FilterSet,
  MatchType,
  RuleOp,
  resolveField,
} from "@lumio/shared";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Numeric/date comparison operator → Prisma range key. */
const RANGE_KEY: Partial<Record<RuleOp, "gt" | "gte" | "lt" | "lte">> = {
  [RuleOp.gt]: "gt",
  [RuleOp.gte]: "gte",
  [RuleOp.lt]: "lt",
  [RuleOp.lte]: "lte",
};

function unsupported(rule: FilterRule): never {
  throw new Error(`unsupported rule: ${rule.field}/${rule.op}`);
}

function columnClause(def: FieldDef, rule: FilterRule, now: Date): Prisma.PhotoWhereInput {
  const col = (def.storage as { column: string }).column;
  const wrap = (predicate: unknown): Prisma.PhotoWhereInput =>
    ({ [col]: predicate }) as Prisma.PhotoWhereInput;

  switch (rule.op) {
    case RuleOp.eq:
      // String columns use an explicit `{ equals }`; numeric/bool use the value
      // directly. Compare to the enum member (not the raw "string" literal) — a
      // string-enum vs string-literal comparison is a TS error (TS2367).
      return def.type === FieldType.string ? wrap({ equals: rule.value }) : wrap(rule.value);
    case RuleOp.ne:
      return wrap({ not: rule.value });
    case RuleOp.contains:
      return wrap({ contains: rule.value, mode: "insensitive" });
    case RuleOp.gt:
    case RuleOp.gte:
    case RuleOp.lt:
    case RuleOp.lte:
      return wrap({ [RANGE_KEY[rule.op]!]: rule.value });
    case RuleOp.between: {
      // caller must pass [min, max] in order; the schema validates shape/type, not ordering
      const [min, max] = rule.value as [unknown, unknown];
      return wrap({ gte: min, lte: max });
    }
    case RuleOp.exists:
      return wrap({ not: null });
    case RuleOp.not_exists:
      return wrap({ equals: null });
    case RuleOp.last_30_days:
      return wrap({ gte: new Date(now.getTime() - 30 * DAY_MS) });
    case RuleOp.in_list:
      return wrap({ in: rule.value });
    case RuleOp.not_in_list:
      return wrap({ notIn: rule.value });
    default:
      return unsupported(rule);
  }
}

function jsonClause(def: FieldDef, rule: FilterRule): Prisma.PhotoWhereInput {
  const path = (def.storage as { path: string[] }).path;
  const wrap = (filter: Record<string, unknown>): Prisma.PhotoWhereInput =>
    ({ exif: { path, ...filter } }) as Prisma.PhotoWhereInput;

  switch (rule.op) {
    case RuleOp.eq:
      return wrap({ equals: rule.value });
    case RuleOp.ne:
      return wrap({ not: rule.value });
    case RuleOp.contains:
      return wrap({ string_contains: rule.value });
    case RuleOp.gt:
    case RuleOp.gte:
    case RuleOp.lt:
    case RuleOp.lte:
      return wrap({ [RANGE_KEY[rule.op]!]: rule.value });
    case RuleOp.exists:
      return wrap({ not: Prisma.AnyNull });
    case RuleOp.not_exists:
      return wrap({ equals: Prisma.AnyNull });
    default:
      return unsupported(rule);
  }
}

function albumClause(rule: FilterRule): Prisma.PhotoWhereInput {
  const ids = rule.value as string[];
  if (rule.op === RuleOp.in_album) return { albums: { some: { albumId: { in: ids } } } };
  if (rule.op === RuleOp.not_in_album) return { albums: { none: { albumId: { in: ids } } } };
  return unsupported(rule);
}

function filenameClause(rule: FilterRule): Prisma.PhotoWhereInput {
  if (rule.op === RuleOp.contains) return { path: { contains: rule.value as string, mode: "insensitive" } };
  if (rule.op === RuleOp.eq) return { path: { equals: rule.value as string } };
  return unsupported(rule);
}

function compileRule(rule: FilterRule, now: Date): Prisma.PhotoWhereInput {
  const def = resolveField(rule.field);
  if (!def.ops.includes(rule.op)) unsupported(rule);
  switch (def.storage.kind) {
    case "column":
      return columnClause(def, rule, now);
    case "json":
      return jsonClause(def, rule);
    case "album":
      return albumClause(rule);
    case "filename":
      return filenameClause(rule);
    default:
      return unsupported(rule);
  }
}

/**
 * Compile a FilterSet into a Prisma Photo where clause. Pure (no DB); `now` is
 * injected for relative-date ops. Empty rules → {} (matches the whole library).
 * The shared compiler behind both buildSearchWhere and smartAlbumWhere.
 */
export function buildPhotoWhere(filter: FilterSet, now: Date): Prisma.PhotoWhereInput {
  if (filter.rules.length === 0) return {};
  const clauses = filter.rules.map((r) => compileRule(r, now));
  return filter.match === MatchType.all ? { AND: clauses } : { OR: clauses };
}
