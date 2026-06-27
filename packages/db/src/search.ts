import type { Prisma } from "@prisma/client";
import { type FilterSet, MatchType, resolveField, SYSTEM_FIELD_KEYS, type SearchRegistry } from "@lumio/shared";
import { buildPhotoWhere } from "./photo-where.js";

/**
 * Translate search params into a Prisma Photo where clause via the shared
 * engine. The legacy `album` + `q` params become mandatory (AND) clauses — album
 * scope first, then filename contains. A structured `filter` honors its own
 * match: an all-match filter folds flat into the legacy AND (preserving today's
 * shape + clause ordering); an any-match filter is compiled to an OR group that
 * the legacy constraints wrap under AND so they aren't absorbed into the OR.
 * Empty → {} (whole library). `now` is injected for testability.
 *
 * `albumWhere` is a pre-resolved album predicate supplied by DB-backed callers:
 * membership for regular albums OR each smart album's rule-match, OR-combined
 * (see `albumsSearchWhere`). When given it replaces the plain-membership clause —
 * the only way SMART albums match in search, since they have no AlbumPhoto rows.
 * Without it we fall back to plain membership over `p.album` (regular-only),
 * which is correct for registry-less callers (e.g. unit tests, library locate).
 */
export function buildSearchWhere(
  p: { q?: string; album: string[]; filter?: FilterSet },
  now: Date = new Date(),
  registry?: SearchRegistry,
  albumWhere?: Prisma.PhotoWhereInput,
): Prisma.PhotoWhereInput {
  // Mandatory (AND-ed) legacy constraints, already compiled to Prisma shape so the
  // album predicate can be smart-album-aware. Order preserved: album, then filename.
  const legacy: Prisma.PhotoWhereInput[] = [];
  const album =
    albumWhere ?? (p.album.length > 0 ? { albums: { some: { albumId: { in: p.album } } } } : undefined);
  if (album) legacy.push(album);
  if (p.q) legacy.push({ path: { contains: p.q, mode: "insensitive" } });

  // When a registry is provided, drop user filter rules whose field is neither a
  // configured (registered) metadata field NOR a built-in system field (e.g.
  // `extension`). Legacy album/filename clauses are never dropped — they are
  // engine-internal and not user-supplied field names.
  const filterRules = registry
    ? (p.filter?.rules ?? []).filter((r) => {
        // resolveField is safe here: SYSTEM_FIELD_KEYS is Set<keyof typeof FIELD_REGISTRY>,
        // so a system key always resolves to a static FieldDef (never the generic exif.* fallback).
        const d = registry.get(r.field) ?? (SYSTEM_FIELD_KEYS.has(r.field) ? resolveField(r.field) : undefined);
        return !!d && (d.ops.length === 0 || d.ops.includes(r.op));
      })
    : (p.filter?.rules ?? []);
  const filter = p.filter ? { match: p.filter.match, rules: filterRules } : undefined;

  // No structured filter, or an all-match one: AND everything flat — preserves the
  // legacy output shape + clause ordering (album, filename, then filter rules).
  if (!filter || filter.match === MatchType.all) {
    // buildPhotoWhere returns {} for no rules, else { AND: [...] }; flatten its
    // clauses in so they sit beside the legacy ones under a single AND.
    const compiled = buildPhotoWhere({ match: MatchType.all, rules: filter?.rules ?? [] }, now, registry);
    const filterClauses = "AND" in compiled ? (compiled.AND as Prisma.PhotoWhereInput[]) : [];
    const all = [...legacy, ...filterClauses];
    return all.length === 0 ? {} : { AND: all };
  }

  // any-match filter: legacy album/filename stay mandatory (AND), wrapping the
  // filter's OR group so they aren't absorbed into the OR.
  const filterClause = buildPhotoWhere(filter, now, registry);
  if (legacy.length === 0) return filterClause;
  return { AND: [{ AND: legacy }, filterClause] };
}
