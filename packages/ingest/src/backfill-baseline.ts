import type { PrismaClient } from "@lumio/db";
import { estimateAsShotFromImage } from "./wb-estimate.js";
import { thumbnailPath } from "./paths.js";

/**
 * Estimate + store the as-shot WB baseline for existing photos that don't have one
 * yet AND are unedited (`edits` null) — assigning a baseline to an edited photo
 * would shift the meaning of its saved temperature, so those are skipped. Reads
 * each photo's thumbnail from its per-catalog cache under `cacheRoot`. A missing
 * thumbnail or unreadable image is skipped (estimate returns null). Returns the
 * number of photos updated.
 *
 * Idempotent: only rows with `asShotTempK` null are considered, so re-running it
 * never re-touches an already-backfilled (or freshly-ingested) photo.
 */
export async function backfillBaselines(
  db: Pick<PrismaClient, "photo">,
  cacheRoot: string,
): Promise<number> {
  const rows = await db.photo.findMany({
    where: { asShotTempK: null },
    select: { id: true, catalogId: true, edits: true },
  });
  let updated = 0;
  for (const row of rows) {
    if (row.edits != null) continue; // never re-anchor an edited photo
    const wb = await estimateAsShotFromImage(thumbnailPath(cacheRoot, row.catalogId, row.id));
    if (!wb) continue;
    await db.photo.update({ where: { id: row.id }, data: { asShotTempK: wb.k, asShotTint: wb.tint } });
    updated++;
  }
  return updated;
}
