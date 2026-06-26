import type { Prisma } from "@prisma/client";
import type { SearchRegistry, SmartAlbumRules } from "@lumio/shared";
import { smartAlbumWhere } from "./smart-albums.js";

/**
 * Build the Prisma `where` for the recursive, deduplicated photo set of a folder:
 * the OR of explicit membership in any descendant **regular** album and the rule
 * predicate of every descendant **smart** album. `now` is injected so the
 * function stays pure and testable. Empty input → a never-match clause.
 *
 * `registry` is the per-catalog field registry: smart-album rules over custom
 * metadata fields (e.g. a Choice field's `in_list`) only resolve with it. Pass
 * it whenever a descendant smart album may reference custom fields, or those
 * rules throw `unsupported rule`.
 */
export function folderPhotoWhere(
  args: { regularAlbumIds: string[]; smartAlbums: { rules: SmartAlbumRules }[] },
  now: Date,
  registry?: SearchRegistry,
): Prisma.PhotoWhereInput {
  const branches: Prisma.PhotoWhereInput[] = [];
  if (args.regularAlbumIds.length > 0) {
    branches.push({ albums: { some: { albumId: { in: args.regularAlbumIds } } } });
  }
  for (const a of args.smartAlbums) {
    branches.push(smartAlbumWhere(a.rules, now, registry));
  }
  if (branches.length === 0) return { id: { in: [] } };
  return { OR: branches };
}
