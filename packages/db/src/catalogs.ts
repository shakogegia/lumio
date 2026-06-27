import type { PrismaClient } from "@prisma/client";
import { type CreateCatalogInput, DEFAULT_UPLOAD_TEMPLATE, slugify } from "@lumio/shared";
import { prisma } from "./client.js";

type CatalogDb = Pick<PrismaClient, "catalog">;

export async function uniqueSlug(base: string, db: CatalogDb = prisma): Promise<string> {
  let slug = base; let n = 2;
  while (await db.catalog.findUnique({ where: { slug } })) slug = `${base}-${n++}`;
  return slug;
}

// Custom order first (fractional `position`), NULLS LAST so un-backfilled rows
// keep createdAt order; createdAt breaks ties. This order drives the management
// list AND the catalog switcher.
export function listCatalogs(db: CatalogDb = prisma) {
  return db.catalog.findMany({
    orderBy: [{ position: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
  });
}

/** Persist a batch of fractional-position updates in one transaction. */
export async function applyCatalogPositions(
  updates: Array<{ id: string; position: string }>,
  db: Pick<PrismaClient, "$transaction" | "catalog"> = prisma,
): Promise<void> {
  if (updates.length === 0) return;
  await db.$transaction(
    updates.map((u) => db.catalog.update({ where: { id: u.id }, data: { position: u.position } })),
  );
}
export function getCatalogBySlug(slug: string, db: CatalogDb = prisma) { return db.catalog.findUnique({ where: { slug } }); }
export function getCatalogById(id: string, db: CatalogDb = prisma) { return db.catalog.findUnique({ where: { id } }); }

export async function createCatalog(input: CreateCatalogInput, db: CatalogDb = prisma) {
  const slug = await uniqueSlug(slugify(input.name), db);
  // Seed the canonical (prefixed-token) default so new catalogs match the
  // tokens documented in the editor, rather than the legacy DB column default.
  return db.catalog.create({
    data: { name: input.name, slug, path: input.path, uploadTemplate: DEFAULT_UPLOAD_TEMPLATE },
  });
}

export async function renameCatalog(id: string, name: string, db: CatalogDb = prisma) {
  const slug = await uniqueSlug(slugify(name), db);
  return db.catalog.update({ where: { id }, data: { name, slug } });
}

/** Delete the catalog row; FK cascade removes its photos/albums/folders/trash. */
export function deleteCatalog(id: string, db: CatalogDb = prisma) { return db.catalog.delete({ where: { id } }); }

export function setUploadTemplate(id: string, uploadTemplate: string, db: CatalogDb = prisma) {
  return db.catalog.update({ where: { id }, data: { uploadTemplate } });
}
