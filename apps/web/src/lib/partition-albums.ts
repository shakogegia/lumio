import type { AlbumSummaryDTO } from "@lumio/shared";

/**
 * Split albums into hand-made (regular) and smart, preserving input order
 * within each group. Drives the two labeled sections on the /albums page.
 */
export function partitionAlbums(albums: AlbumSummaryDTO[]): {
  regular: AlbumSummaryDTO[];
  smart: AlbumSummaryDTO[];
} {
  const regular: AlbumSummaryDTO[] = [];
  const smart: AlbumSummaryDTO[] = [];
  for (const album of albums) {
    (album.isSmart ? smart : regular).push(album);
  }
  return { regular, smart };
}
