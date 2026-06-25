import path from "node:path";
import { getCatalogById, prisma } from "@lumio/db";
import { type JobHandlers, finalizeTrash, purgeAllPhotos, purgePendingPhotos, purgeTrash } from "@lumio/jobs";
import { JobType } from "@lumio/shared";
import { CACHE_DIR, TRASH_DIR } from "./config.js";
import { log } from "./log.js";
import { scanCatalog } from "./scan.js";

export interface HandlerDeps {
  /** Returns ScanSummary; typed as unknown here since the handler ignores it (keeps the seam loose). */
  scan: (onProgress?: (done: number, total: number) => void) => Promise<unknown>;
  purgeAll: () => Promise<{ deleted: number }>;
  emptyTrash: () => Promise<{ deleted: number }>;
  processTrash: (onProgress?: (done: number) => void) => Promise<{ finalized: number }>;
}

/** Build the per-catalog deps a job needs, resolving the catalog row + its dirs. */
function depsForCatalog(catalogId: string): HandlerDeps {
  return {
    scan: async (onProgress) => {
      const c = await getCatalogById(catalogId);
      if (c) await scanCatalog(c, onProgress);
    },
    purgeAll: async () => {
      const c = await getCatalogById(catalogId);
      if (!c) return { deleted: 0 };
      return purgeAllPhotos({ db: prisma, catalogId, photosDir: c.path, cacheDir: path.join(CACHE_DIR, catalogId) });
    },
    emptyTrash: async () => {
      const c = await getCatalogById(catalogId);
      if (!c) return { deleted: 0 };
      const a = await purgeTrash(undefined, { db: prisma, catalogId, trashDir: path.join(TRASH_DIR, catalogId) });
      const b = await purgePendingPhotos(undefined, { db: prisma, catalogId, photosDir: c.path, cacheDir: path.join(CACHE_DIR, catalogId) });
      return { deleted: a.deleted + b.deleted };
    },
    processTrash: async (onProgress) => {
      const c = await getCatalogById(catalogId);
      if (!c) return { finalized: 0 };
      return finalizeTrash(
        { db: prisma, catalogId, photosDir: c.path, cacheDir: path.join(CACHE_DIR, catalogId), trashDir: path.join(TRASH_DIR, catalogId) },
        onProgress,
      );
    },
  };
}

/** The worker's job handlers, keyed by job type. `makeDeps` is injectable for tests. Each handler reads job.catalogId. */
export function buildHandlers(makeDeps: (catalogId: string) => HandlerDeps = depsForCatalog): Required<JobHandlers> {
  return {
    [JobType.rescan]: async (report, job) => {
      if (!job.catalogId) return;
      await makeDeps(job.catalogId).scan((done, total) => {
        // Progress writes are best-effort telemetry: never block or fail the scan,
        // but don't silently swallow a write error either.
        void report(done, total, "Scanning…").catch((err) => {
          log.warn(`progress write failed: ${err instanceof Error ? err.message : String(err)}`, { scope: "consumer", jobId: job.id });
        });
      });
    },
    [JobType.purge_all]: async (report, job) => {
      if (!job.catalogId) return;
      await report(0, null, "Deleting all photos…");
      const { deleted } = await makeDeps(job.catalogId).purgeAll();
      await report(deleted, deleted, null);
    },
    [JobType.empty_trash]: async (report, job) => {
      if (!job.catalogId) return;
      await report(0, null, "Emptying trash…");
      const { deleted } = await makeDeps(job.catalogId).emptyTrash();
      await report(deleted, deleted, null);
    },
    [JobType.process_trash]: async (report, job) => {
      if (!job.catalogId) return;
      await report(0, null, "Moving photos to Trash…");
      const { finalized } = await makeDeps(job.catalogId).processTrash((done) => {
        void report(done, null, "Moving photos to Trash…").catch(() => {});
      });
      await report(finalized, finalized, null);
    },
  };
}
