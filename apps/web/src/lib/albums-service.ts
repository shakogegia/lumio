import { prisma, toAlbumDTO } from "@lumio/db";
import type { AlbumDTO } from "@lumio/shared";

export async function listAlbums(): Promise<AlbumDTO[]> {
  const rows = await prisma.album.findMany({ orderBy: { createdAt: "asc" } });
  return rows.map(toAlbumDTO);
}
