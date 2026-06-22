import { readFile } from "node:fs/promises";
import { prisma } from "@lumio/db";
import { computeThumbhash } from "@lumio/ingest";
import { thumbnailPath } from "./config.js";

/**
 * One-time backfill: compute a ThumbHash for every photo missing one, reading
 * the already-generated thumbnail (no originals needed). Idempotent — rerunning
 * only touches rows still null. Tolerates a missing thumbnail file (skips it).
 */
async function main(): Promise<void> {
  const rows = await prisma.photo.findMany({
    where: { thumbhash: null },
    select: { id: true, catalogId: true },
  });
  console.log(`Backfilling thumbhash for ${rows.length} photos…`);
  let done = 0;
  let skipped = 0;
  for (const { id, catalogId } of rows) {
    try {
      const buf = await readFile(thumbnailPath(catalogId, id));
      const thumbhash = await computeThumbhash(buf);
      await prisma.photo.update({ where: { id }, data: { thumbhash } });
      done++;
    } catch {
      skipped++;
    }
    if ((done + skipped) % 200 === 0) {
      console.log(`  ${done + skipped}/${rows.length} (updated ${done}, skipped ${skipped})`);
    }
  }
  console.log(`Backfill complete — updated ${done}, skipped ${skipped}.`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
