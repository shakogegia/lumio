import path from "node:path";
import { performance } from "node:perf_hooks";
import type { FSWatcher } from "chokidar";
import chokidar from "chokidar";
import { SUPPORTED_EXTENSIONS, ingestPath, removePath } from "@lumio/ingest";
import { activity } from "./activity.js";
import { PHOTOS_DIR } from "./config.js";
import { ingestDeps, removeDeps } from "./deps.js";
import { timedLine } from "./format.js";
import { scanAndIngest } from "./scan.js";

const isSupported = (p: string): boolean =>
  SUPPORTED_EXTENSIONS.has(path.extname(p).toLowerCase());

/**
 * Initial scan + continuous watch. Bumps `activity.importing` while ingesting
 * new files so the heartbeat can surface steady-state import activity. Returns
 * the watcher so the caller owns shutdown; never calls process.exit itself.
 */
export async function startWatcher(signal: AbortSignal): Promise<FSWatcher> {
  const initial = await scanAndIngest();
  console.log(`Initial scan — processed ${initial.processed}, removed ${initial.removed}`);

  const watcher = chokidar.watch(PHOTOS_DIR, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
  });

  const upsert = async (abs: string): Promise<void> => {
    if (!isSupported(abs)) return;
    const rel = path.relative(PHOTOS_DIR, abs);
    activity.importing++;
    try {
      const start = performance.now();
      await ingestPath(rel, ingestDeps);
      console.log(`+ ${timedLine(rel, performance.now() - start)}`);
    } catch (err) {
      console.warn(`skip ${rel}: ${(err as Error).message}`);
    } finally {
      activity.importing--;
    }
  };

  watcher
    .on("add", upsert)
    .on("change", upsert)
    .on("unlink", async (abs: string) => {
      if (!isSupported(abs)) return;
      const rel = path.relative(PHOTOS_DIR, abs);
      try {
        await removePath(rel, removeDeps);
        console.log(`- ${rel}`);
      } catch (err) {
        console.warn(`remove failed ${rel}: ${(err as Error).message}`);
      }
    })
    .on("error", (err) => console.error(`watcher error: ${String(err)}`));

  console.log(`Watching ${PHOTOS_DIR} …`);
  signal.addEventListener("abort", () => void watcher.close(), { once: true });
  return watcher;
}
