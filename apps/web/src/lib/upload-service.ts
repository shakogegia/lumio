import { createHash } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@lumio/db";
import {
  extractUploadDate,
  findPhotoByHash,
  ingestPath,
  placeUpload,
  SUPPORTED_EXTENSIONS,
} from "@lumio/ingest";
import { PhotoSource, renderTemplate, validateTemplate } from "@lumio/shared";

export interface UploadDeps {
  db: Pick<PrismaClient, "photo">;
  photosDir: string;
  thumbnailsDir: string;
  displaysDir: string;
  template: string;
  now?: Date;
}

export interface UploadInput {
  bytes: Buffer;
  originalFilename: string;
  lastModified?: number;
}

export type UploadResult =
  | { status: "added"; id: string; path: string }
  | { status: "duplicate"; id: string }
  | { status: "unsupported" }
  | { status: "error"; message: string };

export async function handleUpload(input: UploadInput, deps: UploadDeps): Promise<UploadResult> {
  const ext = path.extname(input.originalFilename).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.has(ext)) return { status: "unsupported" };

  const hash = createHash("sha256").update(input.bytes).digest("hex");
  const existing = await findPhotoByHash(hash, deps.db);
  if (existing) return { status: "duplicate", id: existing.id };

  // Defense in depth: the template comes from validated settings, but never
  // render an invalid one (could yield a malformed path).
  const templateCheck = validateTemplate(deps.template);
  if (!templateCheck.ok) {
    return { status: "error", message: `Invalid upload template: ${templateCheck.error}` };
  }

  const date = await extractUploadDate(input.bytes, input.lastModified, deps.now ?? new Date());
  const desired = renderTemplate(deps.template, { date, originalFilename: input.originalFilename });

  let relPath: string;
  try {
    relPath = await placeUpload({
      bytes: input.bytes,
      relPath: desired,
      photosDir: deps.photosDir,
      mtime: date,
    });
  } catch (err) {
    return { status: "error", message: (err as Error).message };
  }

  try {
    const { id } = await ingestPath(
      relPath,
      {
        db: deps.db,
        photosDir: deps.photosDir,
        thumbnailsDir: deps.thumbnailsDir,
        displaysDir: deps.displaysDir,
      },
      PhotoSource.upload,
    );
    return { status: "added", id, path: relPath };
  } catch (err) {
    // Ingestion failed after the original was written — remove the orphan.
    await rm(path.join(deps.photosDir, relPath), { force: true });
    return { status: "error", message: (err as Error).message };
  }
}
