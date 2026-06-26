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

/** Cursor comparator for "strictly before" in the sort direction. */
function beforeOp(dir: "asc" | "desc"): "lt" | "gt" {
  return dir === "asc" ? "lt" : "gt";
}

/**
 * The current photo's global position in the metadata-sorted sequence. Valued
 * photos rank by (value, photoId) before-cursor; an unvalued photo ranks after
 * every valued photo (seg1count) plus the unvalued rows before it by id.
 */
export async function metadataSortIndexOf(
  current: PhotoStripItem,
  full: Prisma.PhotoWhereInput,
  meta: { fieldId: string; dir: "asc" | "desc" },
  db: MetaDb,
): Promise<number> {
  const op = beforeOp(meta.dir);
  const cur = await db.photoMetadataValue.findUnique({
    where: { photoId_fieldId: { photoId: current.id, fieldId: meta.fieldId } },
    select: { value: true },
  });
  if (cur) {
    return db.photoMetadataValue.count({
      where: {
        fieldId: meta.fieldId,
        photo: full,
        OR: [{ value: { [op]: cur.value } }, { value: cur.value, photoId: { [op]: current.id } }],
      },
    });
  }
  const seg1count = await db.photoMetadataValue.count({ where: { fieldId: meta.fieldId, photo: full } });
  const before = await db.photo.count({
    where: { ...full, metadataValues: { none: { fieldId: meta.fieldId } }, id: { [op]: current.id } },
  });
  return seg1count + before;
}

/** Read a contiguous {id,path} window [offset, offset+limit) across both segments. */
async function readWindow(
  full: Prisma.PhotoWhereInput,
  meta: { fieldId: string; dir: "asc" | "desc" },
  offset: number,
  limit: number,
  db: MetaDb,
): Promise<PhotoStripItem[]> {
  const seg1count = await db.photoMetadataValue.count({ where: { fieldId: meta.fieldId, photo: full } });
  const slice = metadataPageSlice(offset, limit, seg1count);
  const out: PhotoStripItem[] = [];
  if (slice.seg1) {
    const rows = await db.photoMetadataValue.findMany({
      where: { fieldId: meta.fieldId, photo: full },
      orderBy: [{ value: meta.dir }, { photoId: meta.dir }],
      skip: slice.seg1.skip,
      take: slice.seg1.take,
      select: { photo: { select: { id: true, path: true } } },
    });
    out.push(...rows.map((r) => r.photo));
  }
  if (slice.seg2) {
    const rows = await db.photo.findMany({
      where: { ...full, metadataValues: { none: { fieldId: meta.fieldId } } },
      orderBy: [{ id: meta.dir }],
      skip: slice.seg2.skip,
      take: slice.seg2.take,
      select: { id: true, path: true },
    });
    out.push(...rows);
  }
  return out;
}

/**
 * Prev/next + film-strip window for a metadata-sorted scope. Reuses the same
 * two-segment reader as the grid: find the current photo's global index, then
 * read the `window`-sized block around it and split into prev/current/next.
 * Degrades to `[current]` only when the window is empty; a mid-session delete of
 * `current` (block non-empty but `current` absent) is not specially recovered,
 * matching the standard-sort neighbor path.
 */
export async function metadataNeighbors(
  full: Prisma.PhotoWhereInput,
  meta: { fieldId: string; dir: "asc" | "desc" },
  current: PhotoStripItem,
  window: number,
  db: MetaDb,
): Promise<PhotoNeighbors> {
  const index = await metadataSortIndexOf(current, full, meta, db);
  const from = Math.max(0, index - window);
  const limit = index + window - from + 1;
  const block = await readWindow(full, meta, from, limit, db);
  const pos = index - from;
  return {
    prevId: block[pos - 1]?.id ?? null,
    nextId: block[pos + 1]?.id ?? null,
    strip: block.length ? block : [current],
  };
}
