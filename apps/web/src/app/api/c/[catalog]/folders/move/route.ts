import { NextResponse } from "next/server";
import { moveItemsSchema } from "@lumio/shared";
import { FolderCycleError, FolderNotFoundError, moveItems } from "@/lib/folders-service";
import { withCatalog } from "@/lib/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withCatalog(async (request, _context, { catalog }) => {
  const body: unknown = await request.json();
  const parsed = moveItemsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  try {
    const count = await moveItems(catalog.id, parsed.data);
    return NextResponse.json({ count });
  } catch (err) {
    if (err instanceof FolderCycleError) {
      return NextResponse.json(
        { error: "Cannot move a folder into itself or a descendant" },
        { status: 400 },
      );
    }
    if (err instanceof FolderNotFoundError) {
      return NextResponse.json({ error: "Folder not found" }, { status: 404 });
    }
    throw err;
  }
});
