import path from "node:path";
import type { FSWatcher } from "chokidar";
import chokidar from "chokidar";
import { SUPPORTED_EXTENSIONS, removePath } from "@lumio/ingest";
import { listCatalogs, prisma } from "@lumio/db";
import { errorMessage } from "@lumio/shared";
import { activity } from "./activity.js";
import { removeDepsFor } from "./deps.js";
import { SCAN_SELECT, reconcileFile, scanCatalog, type ScanSummary } from "./scan.js";
import { catalogForPath } from "./catalog-routing.js";
import { log } from "./log.js";

const isSupported = (p: string): boolean =>
  SUPPORTED_EXTENSIONS.has(path.extname(p).toLowerCase());

/** How often the watcher reconciles its catalog set against the DB (ms). */
const RECONCILE_DEBOUNCE_MS = 5000;

const emptySummary = (): ScanSummary => ({
  processed: 0,
  skipped: 0,
  skippedUnchanged: 0,
  healed: 0,
  restamped: 0,
  removed: 0,
});

/**
 * Initial scan of all catalogs + continuous watch. Watches ALL catalog roots,
 * routes fs events to the right catalog via longest-prefix matching, and
 * reconciles the watch set against the Catalog table every 5 s.
 */
export async function startWatcher(signal: AbortSignal): Promise<FSWatcher> {
  let catalogs = await listCatalogs();

  for (const c of catalogs) {
    const result = await scanCatalog(c);
    log.info(
      `Initial scan [${c.path}] — processed ${result.processed}, unchanged ${result.skippedUnchanged}, healed ${result.healed}, restamped ${result.restamped}, removed ${result.removed}`,
      { scope: "scan", catalogId: c.id },
    );
  }

  const watcher = chokidar.watch(
    catalogs.map((c) => c.path),
    { ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 } },
  );

  // Reconcile a single touched file.
  const upsert = async (abs: string): Promise<void> => {
    if (!isSupported(abs)) return;
    const catalog = catalogForPath(catalogs, abs);
    if (!catalog) return;
    const rel = path.relative(catalog.path, abs);
    activity.importing++;
    try {
      const row = await prisma.photo.findUnique({
        where: { catalogId_path: { catalogId: catalog.id, path: rel } },
        select: SCAN_SELECT,
      });
      const summary = emptySummary();
      await reconcileFile(catalog, rel, row ?? undefined, summary);
      if (summary.healed) log.info(`healed ${rel}`, { scope: "watch", catalogId: catalog.id });
      else if (summary.restamped) log.info(`restamped ${rel}`, { scope: "watch", catalogId: catalog.id });
    } catch (err) {
      log.warn(`skip ${rel}: ${errorMessage(err)}`, { scope: "watch", catalogId: catalog.id });
    } finally {
      activity.importing--;
    }
  };

  watcher
    .on("add", upsert)
    .on("change", upsert)
    .on("unlink", async (abs: string) => {
      if (!isSupported(abs)) return;
      const catalog = catalogForPath(catalogs, abs);
      if (!catalog) return;
      const rel = path.relative(catalog.path, abs);
      try {
        // A move repoints the row before the file leaves its old path, so the
        // unlink finds no row — don't log a misleading "removed" for that.
        const removed = await removePath(rel, removeDepsFor(catalog));
        if (removed) log.info(`removed ${rel}`, { scope: "watch", catalogId: catalog.id });
      } catch (err) {
        log.warn(`remove failed ${rel}: ${errorMessage(err)}`, { scope: "watch", catalogId: catalog.id });
      }
    })
    .on("error", (err) => log.error(`watcher error: ${String(err)}`, { scope: "watch" }));

  log.info(`Watching ${catalogs.map((c) => c.path).join(", ")} …`, { scope: "watch" });

  // Reconcile watch set against DB every 5 s so added/removed catalogs are
  // picked up without a restart. The upsert/unlink closures close over `catalogs`
  // (a let binding) so reassignment here is immediately visible to them.
  const reconcile = setInterval(async () => {
    try {
      const next = await listCatalogs();
      const prevPaths = new Set(catalogs.map((c) => c.path));
      const nextPaths = new Set(next.map((c) => c.path));

      for (const c of next) {
        if (!prevPaths.has(c.path)) {
          await scanCatalog(c);
          watcher.add(c.path);
          log.info(`Catalog added, now watching ${c.path}`, { scope: "watch", catalogId: c.id });
        }
      }
      for (const c of catalogs) {
        if (!nextPaths.has(c.path)) {
          watcher.unwatch(c.path);
          log.info(`Catalog removed, stopped watching ${c.path}`, { scope: "watch", catalogId: c.id });
        }
      }

      catalogs = next;
    } catch (err) {
      log.warn(`catalog reconcile error: ${errorMessage(err)}`, { scope: "watch" });
    }
  }, RECONCILE_DEBOUNCE_MS);

  signal.addEventListener(
    "abort",
    () => {
      clearInterval(reconcile);
      void watcher.close();
    },
    { once: true },
  );

  return watcher;
}
