import path from "node:path";
import type { FSWatcher } from "chokidar";
import chokidar from "chokidar";
import { SUPPORTED_EXTENSIONS, removePath } from "@lumio/ingest";
import { prisma } from "@lumio/db";
import { activity } from "./activity.js";
import { PHOTOS_DIR } from "./config.js";
import { removeDeps } from "./deps.js";
import { SCAN_SELECT, reconcileFile, scanAndIngest, type ScanSummary } from "./scan.js";

const isSupported = (p: string): boolean =>
  SUPPORTED_EXTENSIONS.has(path.extname(p).toLowerCase());

/**
 * Initial scan + continuous watch. Bumps `activity.importing` while ingesting
 * new files so the heartbeat can surface steady-state import activity. Returns
 * the watcher so the caller owns shutdown; never calls process.exit itself.
 */
export async function startWatcher(signal: AbortSignal): Promise<FSWatcher> {
  const initial = await scanAndIngest();
  console.log(
    `Initial scan — processed ${initial.processed}, unchanged ${initial.skippedUnchanged}, healed ${initial.healed}, restamped ${initial.restamped}, removed ${initial.removed}`,
  );

  const watcher = chokidar.watch(PHOTOS_DIR, {
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
  });

  const emptySummary = (): ScanSummary => ({
    processed: 0,
    skipped: 0,
    skippedUnchanged: 0,
    healed: 0,
    restamped: 0,
    removed: 0,
  });

  // Reconcile a single touched file. A `change` on an already-ingested photo
  // only triggers a full re-import when its content hash actually changed, so
  // editing EXIF or a backup touching the mtime can no longer revert user edits.
  const upsert = async (abs: string): Promise<void> => {
    if (!isSupported(abs)) return;
    const rel = path.relative(PHOTOS_DIR, abs);
    activity.importing++;
    try {
      const row = await prisma.photo.findUnique({ where: { path: rel }, select: SCAN_SELECT });
      const summary = emptySummary();
      await reconcileFile(rel, row ?? undefined, summary);
      // reconcileFile already logs genuine (re-)ingests; surface the quieter
      // outcomes so a fired guard is visible. skippedUnchanged stays silent.
      if (summary.healed) console.log(`healed ${rel}`);
      else if (summary.restamped) console.log(`restamped ${rel}`);
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
