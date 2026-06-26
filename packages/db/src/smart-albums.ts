import type { Prisma } from "@prisma/client";
import type { SmartAlbumRules, SearchRegistry } from "@lumio/shared";
import { buildPhotoWhere } from "./photo-where.js";

/**
 * Translate smart-album rules into a Prisma Photo where clause. Smart albums and
 * ad-hoc search share one engine (buildPhotoWhere); the only difference is the
 * empty-rules sentinel: a smart album with no rules matches nothing.
 * `now` is injected so the function stays pure and testable.
 */
export function smartAlbumWhere(rules: SmartAlbumRules, now: Date, registry?: SearchRegistry): Prisma.PhotoWhereInput {
  if (rules.rules.length === 0) return { id: { in: [] } };
  // SmartAlbumRules is structurally assignable to FilterSet — same { match, rules }
  // shape. If those types ever diverge, add an explicit adapter here.
  return buildPhotoWhere(rules, now, registry);
}
