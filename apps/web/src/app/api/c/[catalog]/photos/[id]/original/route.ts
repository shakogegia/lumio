import { readFile } from "node:fs/promises";
import { originalPath } from "@/lib/server/server-paths";
import { attachmentDisposition } from "@/lib/server/download-archive";
import { withCatalog } from "@/lib/server/with-catalog";
import { binaryResponse, errorJson } from "@/lib/server/route-helpers";
import { getPhotoFile } from "@/lib/server/photos-service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONTENT_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export const GET = withCatalog<{ id: string }>(async (request, context, { catalog }) => {
  const { id } = await context.params;
  const photo = await getPhotoFile(catalog.id, id);
  if (!photo) {
    return errorJson("Photo not found", 404);
  }
  try {
    const file = await readFile(originalPath(catalog, photo.path));
    const ext = photo.path.slice(photo.path.lastIndexOf(".")).toLowerCase();
    const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";
    // Opt-in download mode: force a save with the original's filename.
    if (new URL(request.url).searchParams.get("download")) {
      const base = photo.path.split("/").pop() || photo.path;
      const res = binaryResponse(file, { contentType, cacheControl: "public, max-age=3600" });
      res.headers.set("Content-Disposition", attachmentDisposition(base));
      return res;
    }
    return binaryResponse(file, { contentType, cacheControl: "public, max-age=3600" });
  } catch {
    return errorJson("Original not found", 404);
  }
});
