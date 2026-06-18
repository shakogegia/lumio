/** Canonical photo sort order: newest first, id as the stable tiebreaker.
 *  Shared by the library/album listing queries and the neighbor query so they
 *  paginate over the same sequence. */
export const PHOTO_ORDER = [
  { sortDate: "desc" as const },
  { id: "desc" as const },
];
