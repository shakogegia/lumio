import { NextResponse } from "next/server";
import { prisma } from "@lumio/db";
import { enqueueJob } from "@lumio/jobs";
import { JobType, validateTemplate } from "@lumio/shared";
import { withCatalog } from "@/lib/server/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withCatalog(async (request, _context, { catalog }) => {
  const check = validateTemplate(catalog.uploadTemplate);
  if (!check.ok) {
    return NextResponse.json({ error: `Invalid upload template: ${check.error}` }, { status: 400 });
  }
  const includeFilesystem =
    new URL(request.url).searchParams.get("includeFilesystem") === "true";
  const type = includeFilesystem ? JobType.reorganize_all : JobType.reorganize;
  const job = await enqueueJob(prisma, type, catalog.id);
  return NextResponse.json({ jobId: job.id }, { status: 202 });
});
