import type { Prisma } from "@prisma/client";
import { MatchType, RuleOp, type SmartAlbumRules } from "@lumio/shared";

/**
 * Translate smart-album rules into a Prisma Photo where clause.
 * `now` is injected so the function stays pure and testable.
 */
export function smartAlbumWhere(rules: SmartAlbumRules, now: Date): Prisma.PhotoWhereInput {
  if (rules.rules.length === 0) return { id: { in: [] } };
  const clauses = rules.rules.map((r): Prisma.PhotoWhereInput => {
    if (r.field === "takenAt" && r.op === RuleOp.last_30_days) {
      const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      return { takenAt: { gte: cutoff } };
    }
    if (r.field === "exif.cameraModel" && r.op === RuleOp.eq) {
      return { exif: { path: ["cameraModel"], equals: r.value } };
    }
    throw new Error(`unsupported rule: ${r.field}/${r.op}`);
  });
  return rules.match === MatchType.all ? { AND: clauses } : { OR: clauses };
}
