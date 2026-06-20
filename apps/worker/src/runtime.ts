import os from "node:os";
import { INGEST_CONCURRENCY } from "./config.js";

/**
 * Tune the process for background batch image work, BEFORE any Sharp/fs module
 * loads (so the libuv threadpool picks up the size we set). Both worker entry
 * points call this first. Imports Sharp dynamically so it can't load before
 * UV_THREADPOOL_SIZE is in place.
 *
 * Three levers, all aimed at "ingest a big library without making the machine
 * unusable" — important because the worker shares its box with the web app + DB
 * (and, in local dev, with your editor/browser):
 *  - UV_THREADPOOL_SIZE = pool size, so Sharp's async decode/encode isn't capped
 *    at the libuv default of 4.
 *  - sharp.concurrency(1): one libvips thread per image, so total CPU ≈ the pool
 *    size instead of pool × cores.
 *  - low OS priority (nice): the kernel hands CPU to foreground work first, so a
 *    bulk import yields instead of competing as an equal and the app stays
 *    responsive. (This does NOT reduce heat — only a smaller pool does that.)
 */
export async function bootstrapWorker(): Promise<void> {
  if (!process.env.UV_THREADPOOL_SIZE) {
    process.env.UV_THREADPOOL_SIZE = String(INGEST_CONCURRENCY);
  }

  const sharp = (await import("sharp")).default;
  sharp.concurrency(1);

  let priority = "default";
  try {
    os.setPriority(os.constants?.priority?.PRIORITY_LOW ?? 19);
    priority = String(os.getPriority());
  } catch {
    // setPriority can be unsupported/forbidden in some sandboxes — non-fatal.
  }

  console.log(
    `worker ready — concurrency=${INGEST_CONCURRENCY}, UV_THREADPOOL_SIZE=${process.env.UV_THREADPOOL_SIZE}, sharp.concurrency=1, niceness=${priority}`,
  );
}
