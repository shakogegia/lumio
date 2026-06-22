import { readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import sharp from "sharp";
import { processImage, SUPPORTED_EXTENSIONS } from "@lumio/ingest";
import { INGEST_CONCURRENCY } from "./config.js";
import { runPool } from "./pool.js";

// Measures the dominant per-image cost (processImage: decode + 2× resize + hash).
// It does NOT write to the DB or disk, so it isolates CPU/decode cost. The full
// ingest pipeline adds a small per-image constant (one Prisma upsert + 2 writes).
//
// Pins sharp.concurrency(1) like the real worker, so a pool of N images uses
// ~N cores (no oversubscription). The "← default" row is the current
// INGEST_CONCURRENCY default (half the cores).
//
// The target directory is taken from the first CLI argument (default: ./photos).
// Run against your real library:
//   pnpm bench <dir>
//   INGEST_CONCURRENCY=4 pnpm bench <dir>   # measure a specific pool size

const TARGET_DIR = process.argv[2] ?? path.resolve(process.cwd(), "photos");

async function listImages(): Promise<string[]> {
  const entries = await readdir(TARGET_DIR, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && SUPPORTED_EXTENSIONS.has(path.extname(e.name).toLowerCase()))
    .map((e) => path.join(e.parentPath, e.name));
}

interface PoolHooks {
  /** Called as each task starts (meaningful only when limit=1, i.e. serial). */
  onStart?: (i: number) => void;
  /** Called as each task finishes, with its wall time and lowercased extension. */
  onDone?: (done: number, ms: number, ext: string) => void;
}

async function timePool(files: string[], limit: number, hooks?: PoolHooks): Promise<number> {
  const t = performance.now();
  let done = 0;
  await runPool(files.length, limit, async (i) => {
    hooks?.onStart?.(i);
    const start = performance.now();
    try {
      await processImage(files[i]!);
    } catch {
      /* ignore decode errors for timing */
    }
    hooks?.onDone?.(++done, performance.now() - start, path.extname(files[i]!).toLowerCase());
  });
  return performance.now() - t;
}

/** Overwrite the current stderr line (heartbeat) — padded so shorter lines fully clear. */
function status(msg: string): void {
  process.stderr.write(`\r${msg.padEnd(72)}`);
}

/** Clear the heartbeat line so the next console.log starts clean. */
function clearStatus(): void {
  process.stderr.write(`\r${" ".repeat(72)}\r`);
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
    console.error(`No images under TARGET_DIR=${TARGET_DIR}`);
    process.exit(1);
  }
  const sample = all.slice(0, Math.min(60, all.length));
  console.log(
    `cores=${cores}  default INGEST_CONCURRENCY=${INGEST_CONCURRENCY}  sample=${sample.length}  ` +
      `UV_THREADPOOL_SIZE=${process.env.UV_THREADPOOL_SIZE}  sharp.concurrency=1\n`,
  );

  // Warm up lazy libvips init. On Linux this first decode can take seconds for a
  // JXL/HEIC (software djxl/heif-convert, no hardware sips) — show it's alive.
  status("warming up (first decode + lazy libvips init)…");
  const warmStart = performance.now();
  await processImage(sample[0]!);
  clearStatus();
  console.log(`warmup ${((performance.now() - warmStart) / 1000).toFixed(2)}s\n`);

  // Serial pass: limit=1 means per-image wall time is clean, so accumulate cost
  // by extension — on Linux this is where the software JXL/HEIC tax shows up.
  const perExt = new Map<string, { n: number; ms: number }>();
  const serialMs = await timePool(sample, 1, {
    onStart: (i) => status(`serial ${i + 1}/${sample.length}  decoding ${path.basename(sample[i]!)}…`),
    onDone: (_done, ms, ext) => {
      const e = perExt.get(ext) ?? { n: 0, ms: 0 };
      e.n += 1;
      e.ms += ms;
      perExt.set(ext, e);
    },
  });
  clearStatus();
  const serialPer = serialMs / sample.length;
  console.log(`serial (limit=1)   ${(serialMs / 1000).toFixed(2)}s  |  ${serialPer.toFixed(1)} ms/img`);
  const breakdown = [...perExt.entries()]
    .sort((a, b) => b[1].ms / b[1].n - a[1].ms / a[1].n)
    .map(([ext, e]) => `${ext} ×${e.n} ${(e.ms / e.n).toFixed(0)}ms`)
    .join("   ");
  console.log(`  by format: ${breakdown}\n`);

  const limits = [...new Set([INGEST_CONCURRENCY, 4, 8, cores])].sort((a, b) => a - b);
  for (const limit of limits) {
    const ms = await timePool(sample, limit, {
      onDone: (done) => status(`pool (limit=${limit})  ${done}/${sample.length} done…`),
    });
    clearStatus();
    const per = ms / sample.length;
    const mark = limit === INGEST_CONCURRENCY ? " ← default" : "";
    console.log(
      `pool (limit=${limit})    ${(ms / 1000).toFixed(2)}s  |  ${per.toFixed(1)} ms/img  |  ${(serialPer / per).toFixed(2)}x${mark}`,
    );
  }
  process.exit(0);
}

main();
