import type { PrismaClient } from "@prisma/client";
import { type CreateCatalogInput, slugify } from "@lumio/shared";
import { prisma } from "./client.js";

type CatalogDb = Pick<PrismaClient, "catalog">;

export async function uniqueSlug(base: string, db: CatalogDb = prisma): Promise<string> {
  let slug = base; let n = 2;
  while (await db.catalog.findUnique({ where: { slug } })) slug = `${base}-${n++}`;
  return slug;
}

export function listCatalogs(db: CatalogDb = prisma) { return db.catalog.findMany({ orderBy: { createdAt: "asc" } }); }
export function getCatalogBySlug(slug: string, db: CatalogDb = prisma) { return db.catalog.findUnique({ where: { slug } }); }
export function getCatalogById(id: string, db: CatalogDb = prisma) { return db.catalog.findUnique({ where: { id } }); }

export async function createCatalog(input: CreateCatalogInput, db: CatalogDb = prisma) {
  const slug = await uniqueSlug(slugify(input.name), db);
  return db.catalog.create({ data: { name: input.name, slug, path: input.path } });
}

export async function renameCatalog(id: string, name: string, db: CatalogDb = prisma) {
  const slug = await uniqueSlug(slugify(name), db);
  return db.catalog.update({ where: { id }, data: { name, slug } });
}

/** Delete the catalog row; FK cascade removes its photos/albums/folders/trash. */
export function deleteCatalog(id: string, db: CatalogDb = prisma) { return db.catalog.delete({ where: { id } }); }
