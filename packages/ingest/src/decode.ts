import { execFile, spawn } from "node:child_process";
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

export interface RawImage {
  buffer: Buffer;
  width: number;
  height: number;
  channels: number;
}

/** Run `djxl <path> - --output_format pam` and collect stdout. */
function runDjxlPam(absPath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn("djxl", [absPath, "-", "--output_format", "pam"]);
    const chunks: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => chunks.push(c));
    child.stderr.on("data", () => {}); // djxl logs progress to stderr; ignore
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`djxl exited ${code}`)),
    );
  });
}

/**
 * Decode a JXL to raw pixels in memory by piping `djxl` PAM output to stdout —
 * no temp file, no PNG re-encode. djxl bakes EXIF orientation into the pixels,
 * so the result is already upright (no Sharp `.rotate()` needed downstream).
 */
export async function decodeJxlToRaw(absPath: string): Promise<RawImage> {
  const pam = await runDjxlPam(absPath);
  const { width, height, channels, offset } = parsePAM(pam);
  return { buffer: pam.subarray(offset), width, height, channels };
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

export interface DecodedInput {
  /** Sharp input: the original path (native), a raw pixel buffer (JXL), or a temp PNG path (HEIC). */
  input: string | Buffer;
  /** Present iff `input` is raw pixels → caller passes sharp(input, { raw }). */
  raw?: { width: number; height: number; channels: number };
  /** Whether Sharp must apply EXIF orientation. False only for JXL (djxl bakes orientation into the raw pixels); native + the HEIC temp PNG still need it. */
  rotate: boolean;
  /** Remove any temp artifacts (HEIC temp PNG). No-op for native/JXL. */
  cleanup: () => Promise<void>;
}

/**
 * Return a Sharp-ready input for `absPath`:
 *  - native formats pass the path straight through (rotate via EXIF),
 *  - `.jxl` is piped through djxl into a raw pixel buffer (already upright),
 *  - HEIC/HEIF are converted to a temp PNG via an external tool (with cleanup).
 * Throws if a non-native format has no installed decoder.
 */
export async function decodeToSharpInput(absPath: string): Promise<DecodedInput> {
  const ext = path.extname(absPath).toLowerCase();
  if (NATIVE_EXTENSIONS.has(ext)) {
    return { input: absPath, rotate: true, cleanup: async () => {} };
  }
  if (ext === ".jxl") {
    const { buffer, width, height, channels } = await decodeJxlToRaw(absPath);
    return { input: buffer, raw: { width, height, channels }, rotate: false, cleanup: async () => {} };
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
    await rm(dir, { recursive: true, force: true });
    throw err;
  }
  return {
    input: out,
    rotate: true,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
}
