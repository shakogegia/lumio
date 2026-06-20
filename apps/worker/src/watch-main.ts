import { bootstrapWorker } from "./runtime.js";

// See runtime.ts: tune threadpool / Sharp / priority before Sharp or fs load.
await bootstrapWorker();

const { watchAndIngest } = await import("./watch.js");

watchAndIngest().catch((err) => {
  console.error(err);
  process.exit(1);
});
