import { NextResponse } from "next/server";
import { prisma, isFeatureEnabled, upsertPhotoMetadataValue } from "@lumio/db";
import { FeatureKey } from "@lumio/shared";
import { handleUpload } from "@/lib/server/upload-service";
import { catalogCacheDirs } from "@/lib/server/server-paths";
import { withCatalog } from "@/lib/server/with-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const POST = withCatalog(async (request, _context, { catalog }) => {
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

  const { thumbnailsDir, displaysDir } = catalogCacheDirs(catalog.id);
  const result = await handleUpload(
    { bytes, originalFilename: file.name, lastModified },
    {
      db: prisma,
      catalogId: catalog.id,
      photosDir: catalog.path,
      thumbnailsDir,
      displaysDir,
      uploadTemplate: catalog.uploadTemplate,
    },
  );

  if (result.status === "added") {
    const metaRaw = form.get("metadata");
    if (typeof metaRaw === "string" && metaRaw && (await isFeatureEnabled(catalog.id, FeatureKey.Metadata))) {
      try {
        const values = JSON.parse(metaRaw) as Array<{ fieldId?: unknown; value?: unknown }>;
        for (const v of values) {
          if (typeof v.fieldId === "string" && typeof v.value === "string" && v.value.trim()) {
            await upsertPhotoMetadataValue(result.id, v.fieldId, v.value).catch(() => {});
          }
        }
      } catch {
        /* malformed metadata — ignore, the photo is already added */
      }
    }
  }

  const code =
    result.status === "added"
      ? 201
      : result.status === "duplicate"
        ? 200
        : result.status === "unsupported"
          ? 415
          : 500;
  return NextResponse.json(result, { status: code });
});
