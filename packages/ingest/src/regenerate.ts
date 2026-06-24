import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_BASELINE, type PhotoEdits, type WbBaseline } from "@lumio/shared";
import { decodeToSharpInput } from "./decode.js";
import { buildRenditions } from "./renditions.js";

export interface RegenerateDeps {
  thumbnailsDir: string;
  displaysDir: string;
  editedDisplaysDir: string;
}

/**
 * Rebuild a photo's display + thumbnail renditions edits-aware and write them by
 * id. Heals a missing cache WITHOUT re-importing: touches only the rendition
 * files, never the DB. The returned thumbhash + oriented size match what a
 * correct ingest produced, so a caller that already has them stored need not
 * persist anything.
 *
 * The base display (displaysDir) is always written edit-free. When edits are
 * present the baked rendition is written to editedDisplaysDir and the thumbnail
 * reflects the edited image; when there are no edits the edited file is removed
 * (if it exists) and the thumbnail reflects the base image.
 */
export async function regenerateRenditions(
  absPath: string,
  edits: PhotoEdits | null,
  id: string,
  deps: RegenerateDeps,
  baseline: WbBaseline = DEFAULT_BASELINE,
): Promise<{ thumbhash: string; width: number; height: number }> {
  const decoded = await decodeToSharpInput(absPath);
  try {
    // The base display is always edit-free.
    const base = await buildRenditions(decoded.input, null);
    await mkdir(deps.displaysDir, { recursive: true });
    await mkdir(deps.thumbnailsDir, { recursive: true });
    await writeFile(path.join(deps.displaysDir, `${id}.webp`), base.display);
    if (edits) {
      const edited = await buildRenditions(decoded.input, edits, baseline);
      await mkdir(deps.editedDisplaysDir, { recursive: true });
      await writeFile(path.join(deps.editedDisplaysDir, `${id}.webp`), edited.display);
      await writeFile(path.join(deps.thumbnailsDir, `${id}.webp`), edited.thumbnail);
      return { thumbhash: edited.thumbhash, width: edited.width, height: edited.height };
    }
    await writeFile(path.join(deps.thumbnailsDir, `${id}.webp`), base.thumbnail);
    await rm(path.join(deps.editedDisplaysDir, `${id}.webp`), { force: true });
    return { thumbhash: base.thumbhash, width: base.width, height: base.height };
  } finally {
    await decoded.cleanup();
  }
}
