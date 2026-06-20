import { bootstrapWorker } from "./runtime.js";

// See runtime.ts: tune threadpool / Sharp / priority before Sharp or fs load.
await bootstrapWorker();

const { startWorker } = await import("./start.js");

startWorker().catch((err) => {
  console.error(err);
  process.exit(1);
});
