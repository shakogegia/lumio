import path from "node:path";
import { rm } from "node:fs/promises";
import {
  listCatalogs,
  getCatalogById,
  createCatalog,
  deleteCatalog,
  prisma,
  type Catalog,
} from "@lumio/db";
import { createCatalogSchema, type CreateCatalogInput } from "@lumio/shared";
import { purgeAllPhotos } from "@lumio/jobs";
import { MEDIA_ROOT, CACHE_DIR, TRASH_DIR, isInsideMediaRoot } from "@/lib/server/server-paths";

/**
 * A new catalog path must be inside MEDIA_ROOT and must not equal, contain,
 * or be contained by an existing catalog path.
 */
export function catalogPathConflict(
  newPath: string,
  existingPaths: string[],
): "outside-root" | "overlap" | null {
  if (!isInsideMediaRoot(newPath)) return "outside-root";
  const a = newPath.endsWith(path.sep) ? newPath : newPath + path.sep;
  for (const ex of existingPaths) {
    const b = ex.endsWith(path.sep) ? ex : ex + path.sep;
    if (newPath === ex || a.startsWith(b) || b.startsWith(a)) return "overlap";
  }
  return null;
}

export async function createCatalogChecked(
  input: CreateCatalogInput,
): Promise<{ ok: true; catalog: Catalog } | { ok: false; error: string }> {
  const parsed = createCatalogSchema.safeParse(input);
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const abs = path.resolve(parsed.data.path);
  const existing = await listCatalogs();
  const conflict = catalogPathConflict(
    abs,
    existing.map((c) => c.path),
  );
  if (conflict === "outside-root")
    return { ok: false, error: `Folder must be inside ${MEDIA_ROOT}` };
  if (conflict === "overlap")
    return { ok: false, error: "Folder overlaps an existing catalog" };

  const catalog = await createCatalog({ name: parsed.data.name, path: abs });
  return { ok: true, catalog };
}

export type DeleteMode = "detach" | "delete-originals";

/**
 * Deletes a catalog with the given mode.
 * NOTE: "delete-originals" purges files synchronously, which can be slow for
 * large catalogs. Follow-up: dispatch this as a worker job instead.
 */
export async function deleteCatalogWithMode(id: string, mode: DeleteMode): Promise<void> {
  const catalog = await getCatalogById(id);
  if (!catalog) return;

  if (mode === "delete-originals") {
    await purgeAllPhotos({
      db: prisma,
      catalogId: id,
      photosDir: catalog.path,
      cacheDir: path.join(CACHE_DIR, id),
    });
  }

  await deleteCatalog(id); // cascade removes remaining rows (photos/albums/folders/trash)
  await rm(path.join(CACHE_DIR, id), { recursive: true, force: true });
  await rm(path.join(TRASH_DIR, id), { recursive: true, force: true });
}
