import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PhotoEdits } from "@lumio/shared";
import { decodeToSharpInput } from "./decode.js";
import { buildRenditions } from "./renditions.js";

export interface RegenerateDeps {
  thumbnailsDir: string;
  displaysDir: string;
}

/**
 * Rebuild a photo's display + thumbnail renditions edits-aware and write them by
 * id. Heals a missing cache WITHOUT re-importing: touches only the rendition
 * files, never the DB. The returned thumbhash + oriented size match what a
 * correct ingest produced, so a caller that already has them stored need not
 * persist anything.
 */
export async function regenerateRenditions(
  absPath: string,
  edits: PhotoEdits | null,
  id: string,
  deps: RegenerateDeps,
): Promise<{ thumbhash: string; width: number; height: number }> {
  const decoded = await decodeToSharpInput(absPath);
  try {
    const { display, thumbnail, thumbhash, width, height } = await buildRenditions(
      decoded.input,
      edits,
    );
    await mkdir(deps.displaysDir, { recursive: true });
    await mkdir(deps.thumbnailsDir, { recursive: true });
    await writeFile(path.join(deps.displaysDir, `${id}.webp`), display);
    await writeFile(path.join(deps.thumbnailsDir, `${id}.webp`), thumbnail);
    return { thumbhash, width, height };
  } finally {
    await decoded.cleanup();
  }
}
