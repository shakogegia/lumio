import { prisma } from "@lumio/db";
import { scanAllCatalogs } from "./scan.js";

export async function runIngest(): Promise<void> {
  const start = Date.now();
  const summary = await scanAllCatalogs();
  console.log(
    `Ingestion complete in ${Date.now() - start}ms — processed ${summary.processed}, unchanged ${summary.skippedUnchanged}, healed ${summary.healed}, restamped ${summary.restamped}, skipped ${summary.skipped}, removed ${summary.removed}`,
  );
  await prisma.$disconnect();
}
