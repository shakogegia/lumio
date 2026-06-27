import type { PrismaClient } from "@prisma/client";
import { prisma } from "./client.js";

/**
 * Distinct, non-empty file extensions among LIVE (non-trashed) photos in a
 * catalog, sorted ascending. Powers the "File type" search facet. Uses the
 * @@index([catalogId, extension]).
 */
export async function distinctExtensions(
  catalogId: string,
  db: Pick<PrismaClient, "photo"> = prisma,
): Promise<string[]> {
  const rows = await db.photo.findMany({
    where: { catalogId, trashedAt: null, extension: { not: "" } },
    select: { extension: true },
    distinct: ["extension"],
    orderBy: { extension: "asc" },
  });
  return rows.map((r) => r.extension);
}
