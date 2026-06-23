import { NextResponse } from "next/server";
import { folderDeleteModeSchema, renameFolderSchema } from "@lumio/shared";
import {
  deleteFolder,
  listFolderContents,
  renameFolder,
} from "@/lib/server/folders-service";
import { parseJson, parseQuery, mapServiceError } from "@/lib/server/route-helpers";
import { withCatalog } from "@/lib/server/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withCatalog<{ id: string }>(async (_request, context, { catalog }) => {
  const { id } = await context.params;
  const contents = await listFolderContents(catalog.id, id);
  if (!contents) return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  return NextResponse.json(contents);
});

export const PATCH = withCatalog<{ id: string }>(async (request, context, { catalog }) => {
  const { id } = await context.params;
  const parsed = await parseJson(request, renameFolderSchema);
  if ("response" in parsed) return parsed.response;
  try {
    const folder = await renameFolder(catalog.id, id, parsed.data.name);
    return NextResponse.json(folder);
  } catch (err) {
    const mapped = mapServiceError(err);
    if (mapped) return mapped;
    throw err;
  }
});

export const DELETE = withCatalog<{ id: string }>(
  async (request, context, { catalog }) => {
    const { id } = await context.params;
    const parsed = parseQuery(request, folderDeleteModeSchema);
    if ("response" in parsed) return parsed.response;
    try {
      await deleteFolder(catalog.id, id, parsed.data.mode);
    } catch (err) {
      const mapped = mapServiceError(err);
      if (mapped) return mapped;
      throw err;
    }
    return new NextResponse(null, { status: 204 });
  },
);
