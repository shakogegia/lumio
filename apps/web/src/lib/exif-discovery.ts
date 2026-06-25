import { type PrismaClient, prisma } from "@lumio/db";
import { resolveField } from "@lumio/shared";

type Db = Pick<PrismaClient, "photo"> & { $queryRaw: PrismaClient["$queryRaw"] };

export interface ValueCount {
  value: string;
  count: number;
}

const TTL_MS = 60_000;
const cache = new Map<string, { at: number; data: unknown }>();

function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return Promise.resolve(hit.data as T);
  return load().then((data) => {
    // Bound memory: the values endpoint accepts arbitrary field names, so cap the
    // entry count (a crude clear is fine for a 60s-TTL discovery cache).
    if (cache.size >= 500) cache.clear();
    cache.set(key, { at: Date.now(), data });
    return data;
  });
}

/** Distinct values (+counts) for a field, most common first. Promoted columns use
 *  groupBy; arbitrary EXIF keys read the JSONB path. Non-null, capped at 200. */
export async function distinctValues(field: string, db: Db = prisma as Db): Promise<ValueCount[]> {
  return cached(`values:${field}`, async () => {
    const def = resolveField(field);
    if (def.storage.kind === "column") {
      const col = def.storage.column;
      const rows = (await db.photo.groupBy({
        // `as never`: Prisma's groupBy `by` wants a literal column-name union, not
        // `string`; `col` is validated at definition time via FIELD_REGISTRY.
        by: [col],
        _count: { _all: true },
      } as never)) as Array<Record<string, unknown> & { _count: { _all: number } }>;
      return rows
        .filter((r) => r[col] != null)
        .map((r) => ({
          value: r[col] instanceof Date ? (r[col] as Date).toISOString() : String(r[col]),
          count: r._count._all,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 200);
    }
    if (def.storage.kind === "json") {
      const key = def.storage.path[0]!;
      const rows = await db.$queryRaw<Array<{ value: string; count: bigint }>>`
        SELECT exif->>${key} AS value, COUNT(*) AS count
        FROM "Photo"
        WHERE exif ? ${key} AND exif->>${key} IS NOT NULL
        GROUP BY exif->>${key}
        ORDER BY count DESC
        LIMIT 200`;
      return rows.map((r) => ({ value: r.value, count: Number(r.count) }));
    }
    return [];
  });
}

/** Distinct EXIF keys present across the library (top-level keys of the blob). */
export async function distinctFields(db: Db = prisma as Db): Promise<string[]> {
  return cached("fields", async () => {
    const rows = await db.$queryRaw<Array<{ key: string }>>`
      SELECT DISTINCT jsonb_object_keys(exif) AS key
      FROM "Photo"
      ORDER BY key`;
    return rows.map((r) => r.key);
  });
}
