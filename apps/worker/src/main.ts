import { bootstrapWorker } from "./runtime.js";

// Tune the process (threadpool, single-thread Sharp, low priority) before any
// Sharp/fs module loads, then run the one-shot ingest.
await bootstrapWorker();

const { runIngest } = await import("./ingest-run.js");

runIngest().catch(async (err) => {
  console.error(err);
  const { prisma } = await import("@lumio/db");
  await prisma.$disconnect();
  process.exit(1);
});
