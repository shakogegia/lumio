import type { Prisma } from "@prisma/client";
import type { SmartAlbumRules } from "@lumio/shared";
import { smartAlbumWhere } from "./smart-albums.js";

/**
 * Build the Prisma `where` for the recursive, deduplicated photo set of a folder:
 * the OR of explicit membership in any descendant **regular** album and the rule
 * predicate of every descendant **smart** album. `now` is injected so the
 * function stays pure and testable. Empty input → a never-match clause.
 */
export function folderPhotoWhere(
  args: { regularAlbumIds: string[]; smartAlbums: { rules: SmartAlbumRules }[] },
  now: Date,
): Prisma.PhotoWhereInput {
  const branches: Prisma.PhotoWhereInput[] = [];
  if (args.regularAlbumIds.length > 0) {
    branches.push({ albums: { some: { albumId: { in: args.regularAlbumIds } } } });
  }
  for (const a of args.smartAlbums) {
    branches.push(smartAlbumWhere(a.rules, now));
  }
  if (branches.length === 0) return { id: { in: [] } };
  return { OR: branches };
}
