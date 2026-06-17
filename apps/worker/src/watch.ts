import path from "node:path";
import chokidar from "chokidar";
import { prisma } from "@lumio/db";
import { PHOTOS_DIR, SUPPORTED_EXTENSIONS } from "./config.js";
import { ingestPath, removePath } from "./ingest.js";
import { scanAndIngest } from "./scan.js";

const isSupported = (p: string): boolean =>
  SUPPORTED_EXTENSIONS.has(path.extname(p).toLowerCase());

export async function watchAndIngest(): Promise<void> {
  const initial = await scanAndIngest();
  console.log(`Initial scan — processed ${initial.processed}, removed ${initial.removed}`);

  const watcher = chokidar.watch(PHOTOS_DIR, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
  });

  const upsert = async (abs: string): Promise<void> => {
    if (!isSupported(abs)) return;
    const rel = path.relative(PHOTOS_DIR, abs);
    try {
      await ingestPath(rel);
      console.log(`+ ${rel}`);
    } catch (err) {
      console.warn(`skip ${rel}: ${(err as Error).message}`);
    }
  };

  watcher
    .on("add", upsert)
    .on("change", upsert)
    .on("unlink", async (abs: string) => {
      if (!isSupported(abs)) return;
      const rel = path.relative(PHOTOS_DIR, abs);
      try {
        await removePath(rel);
        console.log(`- ${rel}`);
      } catch (err) {
        console.warn(`remove failed ${rel}: ${(err as Error).message}`);
      }
    })
    .on("error", (err) => console.error(`watcher error: ${String(err)}`));

  console.log(`Watching ${PHOTOS_DIR} … (Ctrl-C to stop)`);

  const shutdown = async (): Promise<void> => {
    await watcher.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
