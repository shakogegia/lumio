import { NextResponse } from "next/server";
import { listAlbumSummaries } from "@/lib/albums-service";
import { listAllFolders } from "@/lib/folders-service";
import { withCatalog } from "@/lib/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The whole album/folder tree in one shot — folders (flat, with parentId) plus
 * album summaries (with folderId + cover). Powers the shared client-side
 * LibraryTreeProvider that the sidebar, "Add to album", and "Move to…" pickers
 * all read from, so they don't each refetch the album list.
 */
export const GET = withCatalog(async (_request, _context, { catalog }) => {
  const [folders, albums] = await Promise.all([
    listAllFolders(catalog.id),
    listAlbumSummaries(catalog.id),
  ]);
  return NextResponse.json({ folders, albums });
});
