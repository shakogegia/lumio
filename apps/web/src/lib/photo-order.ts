import type { PhotoSort } from "@lumio/shared";

/**
 * Map a sort choice to a Prisma `orderBy`: the chosen date field plus an `id`
 * tiebreaker in the SAME direction, so keyset/cursor pagination stays monotonic.
 * `sortDate` is `takenAt ?? importTime` (set at ingest), so the taken-date sorts
 * keep EXIF-less photos chronological by their import time. Shared by the
 * library/album/search listings and the detail-view neighbor query so they
 * paginate over the same sequence.
 */
export function photoOrderBy(sort?: PhotoSort) {
  switch (sort) {
    case "taken-asc":
      return [{ sortDate: "asc" as const }, { id: "asc" as const }];
    case "imported-desc":
      return [{ createdAt: "desc" as const }, { id: "desc" as const }];
    case "imported-asc":
      return [{ createdAt: "asc" as const }, { id: "asc" as const }];
    default: // "taken-desc"
      return [{ sortDate: "desc" as const }, { id: "desc" as const }];
  }
}

/** The default order (newest taken-date first). Used by the album-cover query,
 *  which always shows the most-recent representative regardless of user sort. */
export const PHOTO_ORDER = photoOrderBy();
