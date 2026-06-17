import { prisma } from "@lumio/db";
import { PHOTOS_DIR } from "@/lib/paths";

export async function getStatus() {
  const photoCount = await prisma.photo.count();
  const latest = await prisma.photo.findFirst({
    orderBy: { updatedAt: "desc" },
    select: { updatedAt: true },
  });
  return {
    photosDir: PHOTOS_DIR,
    photoCount,
    lastIndexedAt: latest ? latest.updatedAt.toISOString() : null,
  };
}
