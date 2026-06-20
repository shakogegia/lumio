import { execFile } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { decodeToSharpInput, NATIVE_EXTENSIONS } from "./decode.js";

const execFileAsync = promisify(execFile);

async function hasBin(bin: string): Promise<boolean> {
  try { await execFileAsync("which", [bin]); return true; } catch { return false; }
}
/** JXL tests need cjxl (to build a fixture) and djxl (to decode it). */
const JXL_TOOLS = (await hasBin("cjxl")) && (await hasBin("djxl"));

/** Write a solid-colour PNG, then losslessly transcode it to a .jxl fixture. */
async function makeJxl(srcPng: string, outJxl: string, w: number, h: number): Promise<void> {
  await sharp({ create: { width: w, height: h, channels: 3, background: "#3366aa" } })
    .png()
    .toFile(srcPng);
  await execFileAsync("cjxl", [srcPng, outJxl, "-q", "90"]);
}

const dir = await mkdtemp(path.join(tmpdir(), "lumio-decode-test-"));

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("decodeToSharpInput", () => {
  it("native passthrough: returns the original path, cleanup is a no-op", async () => {
    const tmpPng = path.join(dir, "fixture.png");
    await sharp({ create: { width: 16, height: 16, channels: 3, background: "#ff0000" } })
      .png()
      .toFile(tmpPng);

    const decoded = await decodeToSharpInput(tmpPng);
    expect(decoded.input).toBe(tmpPng);

    await decoded.cleanup();
    const s = await stat(tmpPng);
    expect(s.isFile()).toBe(true); // cleanup is a no-op for native
  });

  it("rejects with 'no external decoder available' for unknown extensions", async () => {
    await expect(decodeToSharpInput("/tmp/whatever.xyz")).rejects.toThrow(
      "no external decoder available",
    );
  });

  it.skipIf(!JXL_TOOLS)("jxl: returns an in-memory JPEG buffer Sharp can read", async () => {
    const src = path.join(dir, "dispatch-src.png");
    const jxl = path.join(dir, "dispatch.jxl");
    await makeJxl(src, jxl, 32, 20);

    const decoded = await decodeToSharpInput(jxl);
    expect(Buffer.isBuffer(decoded.input)).toBe(true);
    const meta = await sharp(decoded.input as Buffer).metadata();
    expect(meta.format).toBe("jpeg");
    expect(meta.width).toBe(32);
    expect(meta.height).toBe(20);
  });
});

it("NATIVE_EXTENSIONS includes common sharp-readable formats", () => {
  expect(NATIVE_EXTENSIONS.has(".jpg")).toBe(true);
  expect(NATIVE_EXTENSIONS.has(".jpeg")).toBe(true);
  expect(NATIVE_EXTENSIONS.has(".png")).toBe(true);
  expect(NATIVE_EXTENSIONS.has(".webp")).toBe(true);
});
