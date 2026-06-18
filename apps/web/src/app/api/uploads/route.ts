import path from "node:path";
import { NextResponse } from "next/server";
import { getSettings, prisma } from "@lumio/db";
import { handleUpload } from "@/lib/upload-service";
import { CACHE_DIR, PHOTOS_DIR } from "@/lib/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<NextResponse> {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ status: "error", message: "No file provided" }, { status: 400 });
  }

  const lastModifiedRaw = form.get("lastModified");
  const lastModified =
    typeof lastModifiedRaw === "string" && lastModifiedRaw.length > 0
      ? Number(lastModifiedRaw)
      : undefined;

  const bytes = Buffer.from(await file.arrayBuffer());
  const { uploadTemplate } = await getSettings();

  const result = await handleUpload(
    { bytes, originalFilename: file.name, lastModified },
    {
      db: prisma,
      photosDir: PHOTOS_DIR,
      thumbnailsDir: path.join(CACHE_DIR, "thumbnails"),
      displaysDir: path.join(CACHE_DIR, "displays"),
      template: uploadTemplate,
    },
  );

  const code =
    result.status === "added"
      ? 201
      : result.status === "duplicate"
        ? 200
        : result.status === "unsupported"
          ? 415
          : 500;
  return NextResponse.json(result, { status: code });
}
