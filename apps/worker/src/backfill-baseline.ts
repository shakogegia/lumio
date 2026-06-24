import { prisma } from "@lumio/db";
import { backfillBaselines } from "@lumio/ingest";
import { CACHE_DIR } from "./config.js";

/**
 * One-time backfill: estimate + store the as-shot WB baseline for every UNEDITED
 * photo still missing one, reading the already-generated thumbnail (no originals
 * needed). Idempotent — rerunning only touches rows still null, and edited photos
 * are skipped (re-anchoring them would shift their saved temperature). See
 * backfillBaselines in @lumio/ingest.
 */
async function main(): Promise<void> {
  console.log("Backfilling as-shot WB baselines…");
  const updated = await backfillBaselines(prisma, CACHE_DIR);
  console.log(`Backfill complete — updated ${updated} photos.`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
