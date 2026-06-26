import { prisma } from "@lumio/db";
import { backfillTakenAt } from "@lumio/ingest";

/**
 * One-time backfill: recover `takenAt` (and `sortDate`) for photos whose stored
 * EXIF carries a capture date the original strict parser dropped because exifr
 * returned it as a string (e.g. PNGs). Idempotent — only touches `takenAt`-null
 * rows. See backfillTakenAt in @lumio/ingest.
 */
async function main(): Promise<void> {
  console.log("Backfilling takenAt from stored EXIF…");
  const updated = await backfillTakenAt(prisma);
  console.log(`Backfill complete — updated ${updated} photos.`);
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
