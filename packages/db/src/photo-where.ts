import { Prisma } from "@prisma/client";
import {
  ValueType,
  type FieldDef,
  type FilterRule,
  type FilterSet,
  MatchType,
  RuleOp,
  resolveField,
  type SearchRegistry,
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
      return def.type === ValueType.string ? wrap({ equals: rule.value }) : wrap(rule.value);
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

/** Custom field → EXISTS over the PhotoMetadataValue relation. */
function metadataClause(def: FieldDef, rule: FilterRule): Prisma.PhotoWhereInput {
  const fieldId = (def.storage as { fieldId: string }).fieldId;
  switch (rule.op) {
    case RuleOp.eq:
      return { metadataValues: { some: { fieldId, value: { equals: rule.value as string, mode: "insensitive" } } } };
    case RuleOp.ne:
      return { metadataValues: { none: { fieldId, value: { equals: rule.value as string, mode: "insensitive" } } } };
    case RuleOp.contains:
      return { metadataValues: { some: { fieldId, value: { contains: rule.value as string, mode: "insensitive" } } } };
    case RuleOp.not_contains:
      return { metadataValues: { none: { fieldId, value: { contains: rule.value as string, mode: "insensitive" } } } };
    case RuleOp.in_list:
      return { metadataValues: { some: { fieldId, value: { in: rule.value as string[] } } } };
    case RuleOp.not_in_list:
      return { metadataValues: { none: { fieldId, value: { in: rule.value as string[] } } } };
    case RuleOp.exists:
      return { metadataValues: { some: { fieldId } } };
    case RuleOp.not_exists:
      return { metadataValues: { none: { fieldId } } };
    default:
      return unsupported(rule);
  }
}

/** Standard field. String fields match the effective value (override ?? EXIF
 *  column); numeric/date fields compile straight onto the typed column. */
function standardClause(def: FieldDef, rule: FilterRule, now: Date): Prisma.PhotoWhereInput {
  const { column, fieldId } = def.storage as { column: string; fieldId: string };
  if (def.type !== ValueType.string) {
    // numeric/date → reuse the column compiler (typed, correct ranges)
    return columnClause(def, rule, now);
  }
  const some = (value: unknown): Prisma.PhotoWhereInput =>
    ({ metadataValues: { some: { fieldId, value } } }) as Prisma.PhotoWhereInput;
  const none = (): Prisma.PhotoWhereInput =>
    ({ metadataValues: { none: { fieldId } } }) as Prisma.PhotoWhereInput;
  const col = (predicate: unknown): Prisma.PhotoWhereInput =>
    ({ [column]: predicate }) as Prisma.PhotoWhereInput;
  const overrideAbsentAnd = (colPred: unknown): Prisma.PhotoWhereInput => ({ AND: [none(), col(colPred)] });

  switch (rule.op) {
    case RuleOp.eq:
      return { OR: [some({ equals: rule.value as string, mode: "insensitive" }), overrideAbsentAnd({ equals: rule.value, mode: "insensitive" })] };
    case RuleOp.ne:
      return { OR: [
        some({ not: { equals: rule.value as string, mode: "insensitive" } }),
        overrideAbsentAnd({ not: { equals: rule.value, mode: "insensitive" } }),
      ] };
    case RuleOp.contains:
      return { OR: [some({ contains: rule.value as string, mode: "insensitive" }), overrideAbsentAnd({ contains: rule.value, mode: "insensitive" })] };
    case RuleOp.not_contains:
      return { OR: [
        some({ not: { contains: rule.value as string, mode: "insensitive" } }),
        overrideAbsentAnd({ not: { contains: rule.value, mode: "insensitive" } }),
      ] };
    case RuleOp.in_list:
      return { OR: [some({ in: rule.value as string[] }), overrideAbsentAnd({ in: rule.value })] };
    case RuleOp.not_in_list:
      return { OR: [some({ notIn: rule.value }), overrideAbsentAnd({ notIn: rule.value })] };
    case RuleOp.exists:
      return { OR: [{ metadataValues: { some: { fieldId } } }, col({ not: null })] };
    case RuleOp.not_exists:
      return { AND: [none(), col({ equals: null })] };
    default:
      return unsupported(rule);
  }
}

function compileRule(rule: FilterRule, now: Date, registry?: SearchRegistry): Prisma.PhotoWhereInput {
  const def = registry?.get(rule.field) ?? resolveField(rule.field);
  if (def.ops.length > 0 && !def.ops.includes(rule.op)) unsupported(rule);
  switch (def.storage.kind) {
    case "column":
      return columnClause(def, rule, now);
    case "json":
      return jsonClause(def, rule);
    case "album":
      return albumClause(rule);
    case "filename":
      return filenameClause(rule);
    case "metadata":
      return metadataClause(def, rule);
    case "standard":
      return standardClause(def, rule, now);
    default:
      return unsupported(rule);
  }
}

/**
 * Compile a FilterSet into a Prisma Photo where clause. Pure (no DB); `now` is
 * injected for relative-date ops. Empty rules → {} (matches the whole library).
 * The shared compiler behind both buildSearchWhere and smartAlbumWhere.
 */
export function buildPhotoWhere(filter: FilterSet, now: Date, registry?: SearchRegistry): Prisma.PhotoWhereInput {
  if (filter.rules.length === 0) return {};
  const clauses = filter.rules.map((r) => compileRule(r, now, registry));
  return filter.match === MatchType.all ? { AND: clauses } : { OR: clauses };
}
