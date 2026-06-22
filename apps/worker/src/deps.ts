import { prisma } from "@lumio/db";
import type { IngestDeps, RegenerateDeps, RemoveDeps } from "@lumio/ingest";
import { catalogCacheDirs } from "./config.js";

/** Ingest/regenerate deps for one catalog: per-catalog cache dirs + the catalog root. */
export function ingestDepsFor(catalog: { id: string; path: string }): IngestDeps & RegenerateDeps {
  const { thumbnailsDir, displaysDir, editedDisplaysDir } = catalogCacheDirs(catalog.id);
  return { db: prisma, catalogId: catalog.id, photosDir: catalog.path, thumbnailsDir, displaysDir, editedDisplaysDir };
}

export function removeDepsFor(catalog: { id: string }): RemoveDeps {
  const { thumbnailsDir, displaysDir, editedDisplaysDir } = catalogCacheDirs(catalog.id);
  return { db: prisma, catalogId: catalog.id, thumbnailsDir, displaysDir, editedDisplaysDir };
}
