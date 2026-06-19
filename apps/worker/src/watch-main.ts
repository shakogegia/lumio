import { INGEST_CONCURRENCY } from "./config.js";

// See main.ts: set the libuv threadpool size before Sharp/fs load.
if (!process.env.UV_THREADPOOL_SIZE) {
  process.env.UV_THREADPOOL_SIZE = String(INGEST_CONCURRENCY);
}

// See main.ts: one libvips thread per image so total CPU ≈ the pool size,
// keeping the co-located web app + Postgres responsive during a bulk import.
const sharp = (await import("sharp")).default;
sharp.concurrency(1);

const { watchAndIngest } = await import("./watch.js");

watchAndIngest().catch((err) => {
  console.error(err);
  process.exit(1);
});
