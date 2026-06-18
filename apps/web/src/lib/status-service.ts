import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { prisma } from "@lumio/db";
import { CACHE_DIR, PHOTOS_DIR } from "@/lib/paths";

/** Recursively sum the size of every file under `dir`. Missing dir -> 0. */
async function dirSize(dir: string): Promise<number> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  let total = 0;
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      total += await dirSize(full);
    } else if (entry.isFile()) {
      try {
        total += (await stat(full)).size;
      } catch {
        // File vanished between readdir and stat; skip it.
      }
    }
  }
  return total;
}

export async function getStatus() {
  const [photoCount, albumCount, latest, photosSize, thumbnailsSize, displaysSize] =
    await Promise.all([
      prisma.photo.count(),
      prisma.album.count(),
      prisma.photo.findFirst({
        orderBy: { updatedAt: "desc" },
        select: { updatedAt: true },
      }),
      dirSize(PHOTOS_DIR),
      dirSize(path.join(CACHE_DIR, "thumbnails")),
      dirSize(path.join(CACHE_DIR, "displays")),
    ]);

  return {
    photosDir: PHOTOS_DIR,
    photoCount,
    albumCount,
    photosSize,
    thumbnailsSize,
    displaysSize,
    lastIndexedAt: latest ? latest.updatedAt.toISOString() : null,
  };
}
