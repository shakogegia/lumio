import { prisma } from "@lumio/db";
import { scanAllCatalogs } from "./scan.js";
import { initWorkerLog, log } from "./log.js";

export async function runIngest(): Promise<void> {
  const closeLog = initWorkerLog(prisma);
  const start = Date.now();
  const summary = await scanAllCatalogs();
  log.info(
    `Ingestion complete in ${Date.now() - start}ms — processed ${summary.processed}, unchanged ${summary.skippedUnchanged}, healed ${summary.healed}, restamped ${summary.restamped}, skipped ${summary.skipped}, removed ${summary.removed}`,
    { scope: "scan" },
  );
  await closeLog();
  await prisma.$disconnect();
}
