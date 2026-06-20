import { NextResponse } from "next/server";
import { prisma } from "@lumio/db";
import { purgeTrash } from "@lumio/jobs";
import { photoIdsSchema } from "@lumio/shared";
import { TRASH_DIR } from "@/lib/paths";
import { withAuth } from "@/lib/with-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withAuth(async (request) => {
  const body: unknown = await request.json();
  const parsed = photoIdsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const result = await purgeTrash(parsed.data.ids, { db: prisma, trashDir: TRASH_DIR });
  return NextResponse.json(result);
});
