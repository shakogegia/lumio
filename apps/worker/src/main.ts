import { INGEST_CONCURRENCY } from "./config.js";

// Size the libuv threadpool (where Sharp's decode/encode runs) to our pool
// BEFORE importing anything that touches it — otherwise Sharp plateaus at the
// default of 4 threads regardless of core count. The dynamic import guarantees
// this env is set first.
if (!process.env.UV_THREADPOOL_SIZE) {
  process.env.UV_THREADPOOL_SIZE = String(INGEST_CONCURRENCY);
}

const { runIngest } = await import("./ingest-run.js");

runIngest().catch(async (err) => {
  console.error(err);
  const { prisma } = await import("@lumio/db");
  await prisma.$disconnect();
  process.exit(1);
});
