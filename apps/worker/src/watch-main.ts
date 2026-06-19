import { INGEST_CONCURRENCY } from "./config.js";

// See main.ts: set the libuv threadpool size before Sharp/fs load.
if (!process.env.UV_THREADPOOL_SIZE) {
  process.env.UV_THREADPOOL_SIZE = String(INGEST_CONCURRENCY);
}

const { watchAndIngest } = await import("./watch.js");

watchAndIngest().catch((err) => {
  console.error(err);
  process.exit(1);
});
