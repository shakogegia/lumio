import { prisma } from "@lumio/db";
import { scanAndIngest } from "./scan.js";

export async function runIngest(): Promise<void> {
  const start = Date.now();
  const summary = await scanAndIngest();
  console.log(
    `Ingestion complete in ${Date.now() - start}ms — processed ${summary.processed}, unchanged ${summary.skippedUnchanged}, skipped ${summary.skipped}, removed ${summary.removed}`,
  );
  await prisma.$disconnect();
}
