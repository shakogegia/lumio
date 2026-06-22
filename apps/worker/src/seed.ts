import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { runPool } from "./pool.js";

/**
 * Dev seeder: multiply a handful of Unsplash photos into N varied JPEGs under
 * <dir>/seed/ so the library has realistic bulk to test the grid, timeline,
 * paging, albums, etc. Each output is a random crop + resize + colour tweak of
 * a random base (so every file has distinct pixels → a distinct content hash,
 * no dedup collisions, no 5000 identical thumbnails) and carries a random EXIF
 * capture date so photos spread out across the timeline.
 *
 * It only writes files — run `pnpm ingest` afterwards (or keep `pnpm watch`
 * running) to index them. `--clean` empties the seed subdir first; pair it with
 * `pnpm ingest` (which reconciles on-disk deletions) for a clean reset.
 *
 * The target directory is taken from the first CLI argument (default: ./photos).
 *
 * Usage:
 *   pnpm seed <dir>                       # 5000 files into <dir>/seed/
 *   pnpm seed <dir> --count 200           # fewer
 *   pnpm seed <dir> --clean               # wipe seed/ first, then regenerate
 *   pnpm seed <dir> --count 50 --clean
 */

const TARGET_DIR = process.argv[2] ?? path.resolve(process.cwd(), "photos");

/** The 9 IDs the login page cycles through (auth-photo-stack.tsx) + 1 to make 10. */
const BASE_IDS = [
  "1506744038136-46273834b3fb",
  "1469474968028-56623f02e42e",
  "1470071459604-3b5ec3a7fe05",
  "1418065460487-3e41a6c84dc5",
  "1501785888041-af3ef285b470",
  "1441974231531-c6227db76b6e",
  "1439066615861-d1af74d74000",
  "1500530855697-b586d89ba3ee",
  "1497436072909-60f360e1d4b1",
  "1426604966848-d7adac402bff", // extra landscape, to round 9 → 10
];

const DEFAULT_COUNT = 5000;
const SUBDIR = "seed";
const CONCURRENCY = 16;
const DATE_SPREAD_YEARS = 3;
/** Width to fetch each base at — generous so random crops still look sharp. */
const BASE_WIDTH = 1600;

interface Args {
  count: number;
  clean: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { count: DEFAULT_COUNT, clean: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--clean") args.clean = true;
    else if (a === "--count") {
      const n = Number(argv[++i]);
      if (!Number.isInteger(n) || n <= 0) {
        throw new Error(`--count needs a positive integer, got "${argv[i]}"`);
      }
      args.count = n;
    } else throw new Error(`unknown argument "${a}"`);
  }
  return args;
}

const rand = (min: number, max: number): number => min + Math.random() * (max - min);
const randInt = (min: number, max: number): number => Math.floor(rand(min, max + 1));
const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]!;

/** A random EXIF capture date string ("YYYY:MM:DD HH:MM:SS") within the last N years. */
export function randomExifDate(now: Date, spreadYears = DATE_SPREAD_YEARS): string {
  const span = spreadYears * 365 * 24 * 60 * 60 * 1000;
  const d = new Date(now.getTime() - Math.floor(Math.random() * span));
  const p = (n: number): string => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}:${p(d.getMonth() + 1)}:${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
  );
}

interface Base {
  id: string;
  buffer: Buffer; // orientation already baked in
  width: number;
  height: number;
}

/** Fetch one base image, auto-orient it, and read its upright dimensions. */
async function fetchBase(id: string): Promise<Base> {
  const url = `https://images.unsplash.com/photo-${id}?w=${BASE_WIDTH}&q=80&fm=jpg`;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const raw = Buffer.from(await res.arrayBuffer());
      // Bake EXIF orientation into pixels and normalise to a clean JPEG so every
      // crop works in upright coordinates and we control the metadata we write.
      const buffer = await sharp(raw).rotate().jpeg({ quality: 90 }).toBuffer();
      const meta = await sharp(buffer).metadata();
      return { id, buffer, width: meta.width ?? BASE_WIDTH, height: meta.height ?? BASE_WIDTH };
    } catch (err) {
      if (attempt === 2) {
        throw new Error(`failed to fetch base ${id}: ${(err as Error).message}`);
      }
    }
  }
  throw new Error("unreachable");
}

/** Generate one varied JPEG from a base and write it to `outPath`. */
async function makeVariant(base: Base, outPath: string, now: Date): Promise<void> {
  // Random crop covering 60–100% of each axis, at a random offset.
  const cropW = Math.round(base.width * rand(0.6, 1));
  const cropH = Math.round(base.height * rand(0.6, 1));
  const left = randInt(0, base.width - cropW);
  const top = randInt(0, base.height - cropH);

  // Downscale the crop to a random display width (never upscale past the crop).
  const targetW = Math.min(cropW, randInt(700, 1500));

  await sharp(base.buffer)
    .extract({ left, top, width: cropW, height: cropH })
    .resize({ width: targetW })
    .modulate({
      brightness: rand(0.9, 1.1),
      saturation: rand(0.85, 1.15),
      hue: randInt(-25, 25),
    })
    .flop(Math.random() < 0.5)
    .withExif({
      IFD0: { Make: "Lumio", Model: "Seeder" },
      IFD2: { DateTimeOriginal: randomExifDate(now) },
    })
    .jpeg({ quality: 80 })
    .toFile(outPath);
}

async function main(): Promise<void> {
  const { count, clean } = parseArgs(process.argv.slice(3));
  const outDir = path.join(TARGET_DIR, SUBDIR);
  const now = new Date();

  if (clean) {
    console.log(`Cleaning ${outDir} …`);
    // maxRetries rides out the intermittent ENOTEMPTY macOS/APFS throws when
    // recursively removing a directory with thousands of files.
    await rm(outDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
  await mkdir(outDir, { recursive: true });

  console.log(`Fetching ${BASE_IDS.length} base images from Unsplash …`);
  const bases = await Promise.all(BASE_IDS.map(fetchBase));

  const pad = String(count).length;
  console.log(`Generating ${count} variants into ${outDir} …`);
  let done = 0;
  const step = Math.max(1, Math.floor(count / 10));
  await runPool(count, CONCURRENCY, async (i) => {
    const name = `seed-${String(i + 1).padStart(pad, "0")}.jpg`;
    await makeVariant(pick(bases), path.join(outDir, name), now);
    done++;
    if (done % step === 0 || done === count) {
      console.log(`  ${done}/${count}`);
    }
  });

  console.log(`\nDone — wrote ${count} files to ${outDir}`);
  console.log("Next: run `pnpm ingest` (or keep `pnpm watch` running) to index them.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
