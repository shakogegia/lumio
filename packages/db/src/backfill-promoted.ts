import type { ExifData } from "@lumio/shared";
import { derivePromotedFields } from "@lumio/shared";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "./client.js";

type Db = Pick<PrismaClient, "photo">;

/**
 * One-off: recompute the promoted columns for every existing Photo from its
 * stored `exif` blob. Pages by `id` cursor in batches. Idempotent.
 * Returns the number of rows updated.
 */
export async function backfillPromoted(db: Db = prisma, batchSize = 500): Promise<number> {
  let cursor: string | undefined;
  let updated = 0;
  for (;;) {
    const rows = await db.photo.findMany({
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: batchSize,
      orderBy: { id: "asc" },
      select: { id: true, exif: true },
    });
    if (rows.length === 0) break;
    for (const row of rows) {
      await db.photo.update({
        where: { id: row.id },
        data: derivePromotedFields(row.exif as ExifData),
      });
      updated++;
    }
    cursor = rows[rows.length - 1]!.id;
    if (rows.length < batchSize) break;
  }
  return updated;
}

// CLI (run from repo root): pnpm exec tsx packages/db/src/backfill-promoted.ts
if (import.meta.url === `file://${process.argv[1]}`) {
  backfillPromoted()
    .then((n) => {
      console.log(`backfilled ${n} photos`);
      return prisma.$disconnect();
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
