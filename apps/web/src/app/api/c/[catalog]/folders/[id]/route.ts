import { NextResponse } from "next/server";
import { folderDeleteModeSchema, renameFolderSchema } from "@lumio/shared";
import {
  deleteFolder,
  FolderNotFoundError,
  listFolderContents,
  renameFolder,
} from "@/lib/folders-service";
import { withCatalog } from "@/lib/with-catalog";

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
  const body: unknown = await request.json();
  const parsed = renameFolderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const folder = await renameFolder(catalog.id, id, parsed.data.name);
    return NextResponse.json(folder);
  } catch (err) {
    if (err instanceof FolderNotFoundError) {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }
    throw err;
  }
});

export const DELETE = withCatalog<{ id: string }>(
  async (request, context, { catalog }) => {
    const { id } = await context.params;
    const { searchParams } = new URL(request.url);
    const parsed = folderDeleteModeSchema.safeParse({
      mode: searchParams.get("mode") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    try {
      await deleteFolder(catalog.id, id, parsed.data.mode);
    } catch (err) {
      if (err instanceof FolderNotFoundError) {
        return NextResponse.json({ error: "Folder not found" }, { status: 404 });
      }
      throw err;
    }
    return new NextResponse(null, { status: 204 });
  },
);
