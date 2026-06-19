import { readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { processImage, SUPPORTED_EXTENSIONS } from "@lumio/ingest";
import { PHOTOS_DIR } from "./config.js";
import { runPool } from "./pool.js";

// Measures the dominant per-image cost (processImage: decode + 2× resize + hash).
// It does NOT write to the DB or disk, so it isolates CPU/decode cost. The full
// ingest pipeline adds a small per-image constant (one Prisma upsert + 2 writes).
//
// Run against your real library; sweep the threadpool to find the real ceiling:
//   pnpm bench
//   UV_THREADPOOL_SIZE=$(nproc) pnpm bench   # Linux
//   UV_THREADPOOL_SIZE=12 pnpm bench         # explicit

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
  const all = await listImages();
  if (all.length === 0) {
    console.error(`No images under PHOTOS_DIR=${PHOTOS_DIR}`);
    process.exit(1);
  }
  const cores = os.cpus().length;
  const sample = all.slice(0, Math.min(60, all.length));
  console.log(
    `cores=${cores}  sample=${sample.length}  UV_THREADPOOL_SIZE=${process.env.UV_THREADPOOL_SIZE ?? "4 (default)"}\n`,
  );

  await processImage(sample[0]!); // warm up lazy libvips init

  const serialMs = await timePool(sample, 1);
  const serialPer = serialMs / sample.length;
  console.log(`serial (limit=1)   ${(serialMs / 1000).toFixed(2)}s  |  ${serialPer.toFixed(1)} ms/img`);

  for (const limit of [4, 8, cores]) {
    const ms = await timePool(sample, limit);
    const per = ms / sample.length;
    console.log(
      `pool (limit=${limit})    ${(ms / 1000).toFixed(2)}s  |  ${per.toFixed(1)} ms/img  |  ${(serialPer / per).toFixed(2)}x`,
    );
  }
  process.exit(0);
}

main();
