import { prisma } from "@lumio/db";
import { scanAndIngest } from "./scan.js";

async function main(): Promise<void> {
  const start = Date.now();
  const summary = await scanAndIngest();
  console.log(
    `Ingestion complete in ${Date.now() - start}ms — processed ${summary.processed}, skipped ${summary.skipped}, removed ${summary.removed}`,
  );
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
