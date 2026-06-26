import type { Prisma, PrismaClient } from "@lumio/db";
import { toPhotoDTO } from "@lumio/db";
import {
  DEFAULT_PHOTO_SORT,
  FieldType,
  parseMetadataSort,
  type PhotoDTO,
  type PhotoNeighbors,
  type PhotoSort,
  type PhotosPage,
  type PhotoStripItem,
} from "@lumio/shared";

/** Db surface the metadata-sort path needs. */
export type MetaDb = Pick<PrismaClient, "photo" | "photoMetadataValue" | "metadataField">;

/** A sort resolved against a catalog: a fixed ordering, or a validated Date field. */
export type ResolvedSort =
  | { kind: "standard"; sort?: PhotoSort }
  | { kind: "metadata"; fieldId: string; dir: "asc" | "desc" };

/**
 * Resolve a sort token against a catalog. A `meta:` token is validated against
 * the schema (field exists, enabled, type Date); anything invalid (missing,
 * disabled, wrong type, foreign catalog) degrades to the standard default
 * ordering. Fixed sorts pass through without a query.
 */
export async function resolveSort(
  catalogId: string,
  sort: PhotoSort | undefined,
  db: MetaDb,
): Promise<ResolvedSort> {
  const meta = parseMetadataSort(sort);
  if (!meta) return { kind: "standard", sort };
  const field = await db.metadataField.findFirst({
    where: { id: meta.fieldId, catalogId, enabled: true, type: FieldType.Date },
    select: { id: true },
  });
  return field
    ? { kind: "metadata", fieldId: meta.fieldId, dir: meta.dir }
    : { kind: "standard", sort: DEFAULT_PHOTO_SORT };
}

interface SegSlice {
  skip: number;
  take: number;
}

export interface MetadataSlice {
  seg1: SegSlice | null;
  seg2: SegSlice | null;
}

/**
 * Slice an offset/limit window across the concatenation [valued ++ unvalued],
 * where `seg1count` is the number of in-scope photos that have a value. seg1 is
 * the valued segment (ordered by value), seg2 the unvalued tail (ordered by id).
 * Pure — the only non-trivial pagination arithmetic, tested in isolation.
 */
export function metadataPageSlice(offset: number, limit: number, seg1count: number): MetadataSlice {
  const seg1: SegSlice | null =
    offset < seg1count ? { skip: offset, take: Math.min(limit, seg1count - offset) } : null;
  const taken1 = seg1?.take ?? 0;
  const seg2take = limit - taken1;
  const seg2: SegSlice | null =
    seg2take > 0 ? { skip: Math.max(0, offset - seg1count), take: seg2take } : null;
  return { seg1, seg2 };
}

/**
 * One page of photos ordered by a Date metadata field, nulls-last. Queries from
 * the value side so each scope's existing `full` where reuses verbatim under
 * `photo:`; the unvalued tail is a separate `metadataValues: { none }` query.
 * `full` must already include catalogId + the live-photo filter + the scope where.
 */
export async function listPhotosByMetadata(
  full: Prisma.PhotoWhereInput,
  meta: { fieldId: string; dir: "asc" | "desc" },
  page: { limit: number; offset: number },
  db: MetaDb,
): Promise<PhotosPage> {
  const [total, seg1count] = await Promise.all([
    db.photo.count({ where: full }),
    db.photoMetadataValue.count({ where: { fieldId: meta.fieldId, photo: full } }),
  ]);
  const slice = metadataPageSlice(page.offset, page.limit, seg1count);
  const items: PhotoDTO[] = [];
  if (slice.seg1) {
    const rows = await db.photoMetadataValue.findMany({
      where: { fieldId: meta.fieldId, photo: full },
      orderBy: [{ value: meta.dir }, { photoId: meta.dir }],
      skip: slice.seg1.skip,
      take: slice.seg1.take,
      include: { photo: true },
    });
    items.push(...rows.map((r) => toPhotoDTO(r.photo)));
  }
  if (slice.seg2) {
    const rows = await db.photo.findMany({
      where: { ...full, metadataValues: { none: { fieldId: meta.fieldId } } },
      orderBy: [{ id: meta.dir }],
      skip: slice.seg2.skip,
      take: slice.seg2.take,
    });
    items.push(...rows.map(toPhotoDTO));
  }
  return { items, total };
}
