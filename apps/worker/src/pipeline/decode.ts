import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Extensions sharp/libvips reads directly (no external decode needed). */
export const NATIVE_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".webp", ".avif", ".tiff", ".tif", ".gif",
]);

interface Converter {
  bin: string;
  args: (input: string, out: string) => string[];
}

/** Format -> ordered candidate converters (first whose binary is on PATH wins). */
export const CONVERTERS: Record<string, Converter[]> = {
  ".jxl": [
    { bin: "djxl", args: (i, o) => [i, o] },
    { bin: "sips", args: (i, o) => ["-s", "format", "png", i, "--out", o] },
  ],
  ".heic": [
    { bin: "sips", args: (i, o) => ["-s", "format", "png", i, "--out", o] },
    { bin: "heif-convert", args: (i, o) => [i, o] },
  ],
  ".heif": [
    { bin: "sips", args: (i, o) => ["-s", "format", "png", i, "--out", o] },
    { bin: "heif-convert", args: (i, o) => [i, o] },
  ],
};

async function onPath(bin: string): Promise<boolean> {
  try {
    await execFileAsync("which", [bin]);
    return true;
  } catch {
    return false;
  }
}

async function resolveConverter(ext: string): Promise<Converter | null> {
  for (const c of CONVERTERS[ext] ?? []) {
    if (await onPath(c.bin)) return c;
  }
  return null;
}

export interface Decoded {
  /** Path to a sharp-readable image (the original, or a temp PNG). */
  path: string;
  /** Remove any temp artifacts. No-op for native passthrough. */
  cleanup: () => Promise<void>;
}

/**
 * Return a sharp-readable path for `absPath`. Native formats pass through
 * unchanged; JXL/HEIC/HEIF are converted to a temp PNG via an external tool.
 * Throws if the format needs a converter but none is installed.
 */
export async function decodeToReadable(absPath: string): Promise<Decoded> {
  const ext = path.extname(absPath).toLowerCase();
  if (NATIVE_EXTENSIONS.has(ext)) {
    return { path: absPath, cleanup: async () => {} };
  }
  const converter = await resolveConverter(ext);
  if (!converter) {
    throw new Error(`no external decoder available for ${ext}`);
  }
  const dir = await mkdtemp(path.join(tmpdir(), "lumio-decode-"));
  const out = path.join(dir, "decoded.png");
  await execFileAsync(converter.bin, converter.args(absPath, out));
  return {
    path: out,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
}
