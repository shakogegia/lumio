import { execFile } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { decodeToReadable, CONVERTERS, NATIVE_EXTENSIONS, parsePAM } from "./decode.js";

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

describe("decodeToReadable", () => {
  it("native passthrough: returns original path and cleanup leaves file intact", async () => {
    const tmpPng = path.join(dir, "fixture.png");
    await sharp({ create: { width: 16, height: 16, channels: 3, background: "#ff0000" } })
      .png()
      .toFile(tmpPng);

    const decoded = await decodeToReadable(tmpPng);
    expect(decoded.path).toBe(tmpPng);

    await decoded.cleanup();

    // File should still exist after cleanup (cleanup is a no-op for native)
    const s = await stat(tmpPng);
    expect(s.isFile()).toBe(true);
  });

  it("rejects with 'no external decoder available' for unknown extensions", async () => {
    await expect(decodeToReadable("/tmp/whatever.xyz")).rejects.toThrow(
      "no external decoder available",
    );
  });

  it("CONVERTERS has djxl as first candidate for .jxl", () => {
    expect(CONVERTERS[".jxl"]?.[0]?.bin).toBe("djxl");
  });

  it("NATIVE_EXTENSIONS includes common sharp-readable formats", () => {
    expect(NATIVE_EXTENSIONS.has(".jpg")).toBe(true);
    expect(NATIVE_EXTENSIONS.has(".jpeg")).toBe(true);
    expect(NATIVE_EXTENSIONS.has(".png")).toBe(true);
    expect(NATIVE_EXTENSIONS.has(".webp")).toBe(true);
  });
});

describe("parsePAM", () => {
  it("reads WIDTH/HEIGHT/DEPTH and the body offset for RGB", () => {
    const header = "P7\nWIDTH 2\nHEIGHT 3\nDEPTH 3\nMAXVAL 255\nTUPLTYPE RGB\nENDHDR\n";
    const body = Buffer.alloc(2 * 3 * 3, 7);
    const pam = Buffer.concat([Buffer.from(header, "ascii"), body]);

    const h = parsePAM(pam);
    expect(h.width).toBe(2);
    expect(h.height).toBe(3);
    expect(h.channels).toBe(3);
    expect(pam.subarray(h.offset).length).toBe(body.length);
  });

  it("reads DEPTH 4 for RGBA", () => {
    const header = "P7\nWIDTH 1\nHEIGHT 1\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n";
    const pam = Buffer.concat([Buffer.from(header, "ascii"), Buffer.alloc(4)]);
    expect(parsePAM(pam).channels).toBe(4);
  });

  it("throws on a buffer with no PAM header", () => {
    expect(() => parsePAM(Buffer.from("not a pam"))).toThrow("invalid PAM");
  });
});
