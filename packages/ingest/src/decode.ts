import { execFile, spawn } from "node:child_process";
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

/**
 * Transcode a JXL to a JPEG buffer by piping `djxl --output_format jpeg` to
 * stdout — no temp file. JPEG is the right intermediate because djxl can encode
 * *any* JXL into it: it tonemaps float/HDR and high-bit-depth pixels down to
 * 8-bit (which the integer PAM/PPM encoders cannot do — they fail outright), and
 * it losslessly reconstructs the original JPEG for JPEG-sourced JXLs. Sharp then
 * reads the JPEG like any native input, honouring its EXIF orientation. On
 * failure the rejection carries djxl's own stderr so the cause is diagnosable.
 */
function decodeJxlToJpeg(absPath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn("djxl", [absPath, "-", "--output_format", "jpeg"]);
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => out.push(c));
    child.stderr.on("data", (c: Buffer) => err.push(c));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolve(Buffer.concat(out));
      const last = Buffer.concat(err).toString().trim().split("\n").pop() ?? "";
      reject(new Error(`djxl failed (exit ${code}) for ${path.basename(absPath)}: ${last}`));
    });
  });
}

export interface DecodedInput {
  /** A Sharp-readable input: the original path (native), a transcoded JPEG buffer (JXL), or a temp PNG path (HEIC). */
  input: string | Buffer;
  /** Remove any temp artifacts (HEIC temp PNG). No-op for native/JXL. */
  cleanup: () => Promise<void>;
}

/**
 * Return a Sharp-ready input for `absPath`:
 *  - native formats pass the path straight through,
 *  - `.jxl` is transcoded to an in-memory JPEG via djxl,
 *  - HEIC/HEIF are converted to a temp PNG via an external tool (with cleanup).
 * Throws if a non-native format has no installed decoder.
 */
export async function decodeToSharpInput(absPath: string): Promise<DecodedInput> {
  const ext = path.extname(absPath).toLowerCase();
  if (NATIVE_EXTENSIONS.has(ext)) {
    return { input: absPath, cleanup: async () => {} };
  }
  if (ext === ".jxl") {
    return { input: await decodeJxlToJpeg(absPath), cleanup: async () => {} };
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
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true });
    },
  };
}
