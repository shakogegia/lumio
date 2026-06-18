import { mkdir, writeFile } from "node:fs/promises";
import { access } from "node:fs/promises";
import path from "node:path";

async function exists(absPath: string): Promise<boolean> {
  try {
    await access(absPath);
    return true;
  } catch {
    return false;
  }
}

export interface PlaceUploadInput {
  bytes: Buffer;
  /** POSIX-style relative path under photosDir (e.g. "2024/2024-03-14/IMG.jpg"). */
  relPath: string;
  photosDir: string;
}

/**
 * Write `bytes` under `photosDir` at `relPath`. If the target exists, append
 * "-1", "-2", … to the filename stem until a free name is found. Returns the
 * final relative path actually written. Blocks path traversal.
 */
export async function placeUpload(input: PlaceUploadInput): Promise<string> {
  const { bytes, relPath, photosDir } = input;
  const resolvedRoot = path.resolve(photosDir);
  const desired = path.resolve(resolvedRoot, relPath);
  if (desired !== resolvedRoot && !desired.startsWith(resolvedRoot + path.sep)) {
    throw new Error("Path traversal blocked");
  }

  const dir = path.dirname(desired);
  const ext = path.extname(desired);
  const stem = path.basename(desired, ext);

  let candidate = desired;
  let n = 0;
  while (await exists(candidate)) {
    n += 1;
    candidate = path.join(dir, `${stem}-${n}${ext}`);
  }

  await mkdir(path.dirname(candidate), { recursive: true });
  await writeFile(candidate, bytes);
  return path.relative(resolvedRoot, candidate).split(path.sep).join("/");
}
