import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

/** sha256 hex of a buffer's bytes — the value stored on `Photo.hash`. */
export function hashBuffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/** sha256 hex of a file's bytes, without decoding it. Used for change detection. */
export async function hashFile(absPath: string): Promise<string> {
  return hashBuffer(await readFile(absPath));
}
