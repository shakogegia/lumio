import { NextResponse } from "next/server";
import { folderDeleteModeSchema, renameFolderSchema } from "@lumio/shared";
import {
  deleteFolder,
  FolderNotFoundError,
  listFolderContents,
  renameFolder,
} from "@/lib/folders-service";
import { withAuth } from "@/lib/with-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withAuth(async (_request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const contents = await listFolderContents(id);
  if (!contents) return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  return NextResponse.json(contents);
});

export const PATCH = withAuth(async (request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const body: unknown = await request.json();
  const parsed = renameFolderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const folder = await renameFolder(id, parsed.data.name);
    return NextResponse.json(folder);
  } catch (err) {
    if (err instanceof FolderNotFoundError) {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }
    throw err;
  }
});

export const DELETE = withAuth(
  async (request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const parsed = folderDeleteModeSchema.safeParse({
      mode: searchParams.get("mode") ?? undefined,
    });
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }
    try {
      await deleteFolder(id, parsed.data.mode);
    } catch (err) {
      if (err instanceof FolderNotFoundError) {
        return NextResponse.json({ error: "Folder not found" }, { status: 404 });
      }
      throw err;
    }
    return new NextResponse(null, { status: 204 });
  },
);
