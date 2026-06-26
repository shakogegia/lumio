import type { Prisma } from "@prisma/client";
import { type FilterRule, type FilterSet, MatchType, RuleOp, type SearchRegistry } from "@lumio/shared";
import { buildPhotoWhere } from "./photo-where.js";

/**
 * Translate search params into a Prisma Photo where clause via the shared
 * engine. The legacy `album` + `q` params are normalized into rules (album
 * membership, then filename contains) and stay mandatory (AND). A structured
 * `filter` honors its own match: an all-match filter folds flat into the legacy
 * AND (preserving today's shape + clause ordering); an any-match filter is
 * compiled to an OR group that the legacy constraints wrap under AND so they
 * aren't absorbed into the OR. Empty → {} (whole library). `now` is injected for
 * testability.
 */
export function buildSearchWhere(
  p: { q?: string; album: string[]; filter?: FilterSet },
  now: Date = new Date(),
  registry?: SearchRegistry,
): Prisma.PhotoWhereInput {
  const legacy: FilterRule[] = [];
  if (p.album.length > 0) legacy.push({ field: "album", op: RuleOp.in_album, value: p.album });
  if (p.q) legacy.push({ field: "filename", op: RuleOp.contains, value: p.q });

  // When a registry is provided, drop user filter rules whose field is not a
  // configured (registered) metadata field. Legacy album/filename rules are
  // never dropped — they are engine-internal and not user-supplied field names.
  const filterRules = registry
    ? (p.filter?.rules ?? []).filter((r) => registry.has(r.field))
    : (p.filter?.rules ?? []);
  const filter = p.filter ? { match: p.filter.match, rules: filterRules } : undefined;

  // No structured filter, or an all-match one: AND everything flat — preserves the
  // legacy output shape + clause ordering (album, filename, then filter rules).
  if (!filter || filter.match === MatchType.all) {
    const rules = [...legacy, ...(filter?.rules ?? [])];
    return buildPhotoWhere({ match: MatchType.all, rules }, now, registry);
  }

  // any-match filter: legacy album/filename stay mandatory (AND), wrapping the
  // filter's OR group so they aren't absorbed into the OR.
  const filterClause = buildPhotoWhere(filter, now, registry);
  if (legacy.length === 0) return filterClause;
  const legacyClause = buildPhotoWhere({ match: MatchType.all, rules: legacy }, now, registry);
  return { AND: [legacyClause, filterClause] };
}
