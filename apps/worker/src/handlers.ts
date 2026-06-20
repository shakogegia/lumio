import { prisma } from "@lumio/db";
import { type JobHandlers, purgeAllPhotos, purgeTrash } from "@lumio/jobs";
import { JobType } from "@lumio/shared";
import { CACHE_DIR, PHOTOS_DIR, TRASH_DIR } from "./config.js";
import { scanAndIngest } from "./scan.js";

/** Injectable seams so the registry is unit-testable without a DB/filesystem. */
export interface HandlerDeps {
  /** Returns ScanSummary; typed as unknown here since the handler ignores it (keeps the seam loose). */
  scan: (onProgress?: (done: number, total: number) => void) => Promise<unknown>;
  purgeAll: () => Promise<{ deleted: number }>;
  emptyTrash: () => Promise<{ deleted: number }>;
}

const defaultDeps: HandlerDeps = {
  scan: scanAndIngest,
  purgeAll: () => purgeAllPhotos({ db: prisma, photosDir: PHOTOS_DIR, cacheDir: CACHE_DIR }),
  emptyTrash: () => purgeTrash(undefined, { db: prisma, trashDir: TRASH_DIR }),
};

/** The worker's job handlers, keyed by job type. */
export function buildHandlers(deps: HandlerDeps = defaultDeps): Required<JobHandlers> {
  return {
    [JobType.rescan]: async (report) => {
      await deps.scan((done, total) => {
        // Progress writes are best-effort telemetry: never block or fail the scan,
        // but don't silently swallow a write error either.
        void report(done, total, "Scanning…").catch((err) => {
          console.warn(`progress write failed: ${err instanceof Error ? err.message : String(err)}`);
        });
      });
    },
    [JobType.purge_all]: async (report) => {
      await report(0, null, "Deleting all photos…");
      const { deleted } = await deps.purgeAll();
      await report(deleted, deleted, null);
    },
    [JobType.empty_trash]: async (report) => {
      await report(0, null, "Emptying trash…");
      const { deleted } = await deps.emptyTrash();
      await report(deleted, deleted, null);
    },
  };
}
