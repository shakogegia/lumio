import { NextResponse } from "next/server";
import { createFolderSchema } from "@lumio/shared";
import { createFolder, FolderNotFoundError, listFolderContents } from "@/lib/folders-service";
import { withCatalog } from "@/lib/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = withCatalog(async (request, _context, { catalog }) => {
  const { searchParams } = new URL(request.url);
  const parentId = searchParams.get("parentId");
  const contents = await listFolderContents(catalog.id, parentId && parentId.length > 0 ? parentId : null);
  if (!contents) return NextResponse.json({ error: "Folder not found" }, { status: 404 });
  return NextResponse.json(contents);
});

export const POST = withCatalog(async (request, _context, { catalog }) => {
  const body: unknown = await request.json();
  const parsed = createFolderSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const folder = await createFolder(catalog.id, parsed.data);
    return NextResponse.json(folder, { status: 201 });
  } catch (err) {
    if (err instanceof FolderNotFoundError) {
      return NextResponse.json({ error: "Parent folder not found" }, { status: 404 });
    }
    throw err;
  }
});
