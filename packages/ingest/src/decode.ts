import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface PamHeader {
  width: number;
  height: number;
  /** Channel count from PAM DEPTH: 1 gray, 3 RGB, 4 RGBA. */
  channels: number;
  /** Byte offset where the raw pixel body begins (just past `ENDHDR\n`). */
  offset: number;
}

/**
 * Parse a binary PAM (`P7`) header — the format `djxl --output_format pam`
 * emits. The header is ASCII `KEY VALUE` lines terminated by `ENDHDR\n`;
 * raw pixels follow immediately.
 */
export function parsePAM(buf: Buffer): PamHeader {
  const marker = "ENDHDR\n";
  const end = buf.indexOf(marker);
  if (end === -1) throw new Error("invalid PAM: no ENDHDR marker");
  const header = buf.toString("ascii", 0, end).split("\n");
  const field = (key: string): number => {
    const line = header.find((l) => l.startsWith(key));
    if (!line) throw new Error(`invalid PAM: missing ${key}`);
    return Number(line.split(/\s+/)[1]);
  };
  return {
    width: field("WIDTH"),
    height: field("HEIGHT"),
    channels: field("DEPTH"),
    offset: end + marker.length,
  };
}

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
  try {
    await execFileAsync(converter.bin, converter.args(absPath, out));
  } catch (err) {
    // The caller never receives a Decoded (so can't cleanup); remove the temp
    // dir here so a corrupt file doesn't leak a dir on every scan cycle.
    await rm(dir, { recursive: true, force: true });
    throw err;
  }
  return {
    path: out,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
}
