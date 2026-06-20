import { readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import sharp from "sharp";
import { processImage, SUPPORTED_EXTENSIONS } from "@lumio/ingest";
import { INGEST_CONCURRENCY, PHOTOS_DIR } from "./config.js";
import { runPool } from "./pool.js";

// Measures the dominant per-image cost (processImage: decode + 2× resize + hash).
// It does NOT write to the DB or disk, so it isolates CPU/decode cost. The full
// ingest pipeline adds a small per-image constant (one Prisma upsert + 2 writes).
//
// Pins sharp.concurrency(1) like the real worker, so a pool of N images uses
// ~N cores (no oversubscription). The "← default" row is the current
// INGEST_CONCURRENCY default (half the cores).
//
// Run against your real library:
//   pnpm bench
//   INGEST_CONCURRENCY=4 pnpm bench   # measure a specific pool size

async function listImages(): Promise<string[]> {
  const entries = await readdir(PHOTOS_DIR, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && SUPPORTED_EXTENSIONS.has(path.extname(e.name).toLowerCase()))
    .map((e) => path.join(e.parentPath, e.name));
}

async function timePool(files: string[], limit: number): Promise<number> {
  const t = performance.now();
  await runPool(files.length, limit, async (i) => {
    try {
      await processImage(files[i]!);
    } catch {
      /* ignore decode errors for timing */
    }
  });
  return performance.now() - t;
}

async function main(): Promise<void> {
  const cores = os.cpus().length;
  // Mirror the worker so the numbers are honest: size the libuv threadpool to the
  // cores (no pool size we sweep gets throttled) and pin one libvips thread per
  // image. Setting the env here is safe — the threadpool initialises on the first
  // Sharp op below, not at import.
  if (!process.env.UV_THREADPOOL_SIZE) process.env.UV_THREADPOOL_SIZE = String(cores);
  sharp.concurrency(1);

  const all = await listImages();
  if (all.length === 0) {
    console.error(`No images under PHOTOS_DIR=${PHOTOS_DIR}`);
    process.exit(1);
  }
  const sample = all.slice(0, Math.min(60, all.length));
  console.log(
    `cores=${cores}  default INGEST_CONCURRENCY=${INGEST_CONCURRENCY}  sample=${sample.length}  ` +
      `UV_THREADPOOL_SIZE=${process.env.UV_THREADPOOL_SIZE}  sharp.concurrency=1\n`,
  );

  await processImage(sample[0]!); // warm up lazy libvips init

  const serialMs = await timePool(sample, 1);
  const serialPer = serialMs / sample.length;
  console.log(`serial (limit=1)   ${(serialMs / 1000).toFixed(2)}s  |  ${serialPer.toFixed(1)} ms/img`);

  const limits = [...new Set([INGEST_CONCURRENCY, 4, 8, cores])].sort((a, b) => a - b);
  for (const limit of limits) {
    const ms = await timePool(sample, limit);
    const per = ms / sample.length;
    const mark = limit === INGEST_CONCURRENCY ? " ← default" : "";
    console.log(
      `pool (limit=${limit})    ${(ms / 1000).toFixed(2)}s  |  ${per.toFixed(1)} ms/img  |  ${(serialPer / per).toFixed(2)}x${mark}`,
    );
  }
  process.exit(0);
}

main();
