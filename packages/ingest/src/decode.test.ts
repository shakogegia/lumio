import { execFile } from "node:child_process";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { decodeToSharpInput, decodeJxlToRaw, parsePAM, NATIVE_EXTENSIONS } from "./decode.js";

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
  it("native passthrough: returns the original path, rotate:true, no temp", async () => {
    const tmpPng = path.join(dir, "fixture.png");
    await sharp({ create: { width: 16, height: 16, channels: 3, background: "#ff0000" } })
      .png()
      .toFile(tmpPng);

    const decoded = await decodeToSharpInput(tmpPng);
    expect(decoded.input).toBe(tmpPng);
    expect(decoded.raw).toBeUndefined();
    expect(decoded.rotate).toBe(true);

    await decoded.cleanup();
    const s = await stat(tmpPng);
    expect(s.isFile()).toBe(true); // cleanup is a no-op for native
  });

  it("rejects with 'no external decoder available' for unknown extensions", async () => {
    await expect(decodeToSharpInput("/tmp/whatever.xyz")).rejects.toThrow(
      "no external decoder available",
    );
  });

  it.skipIf(!JXL_TOOLS)("jxl: returns a raw buffer with dims and rotate:false", async () => {
    const src = path.join(dir, "dispatch-src.png");
    const jxl = path.join(dir, "dispatch.jxl");
    await makeJxl(src, jxl, 32, 20);

    const decoded = await decodeToSharpInput(jxl);
    expect(Buffer.isBuffer(decoded.input)).toBe(true);
    expect(decoded.raw).toEqual({ width: 32, height: 20, channels: 3 });
    expect(decoded.rotate).toBe(false);
  });
});

it("NATIVE_EXTENSIONS includes common sharp-readable formats", () => {
  expect(NATIVE_EXTENSIONS.has(".jpg")).toBe(true);
  expect(NATIVE_EXTENSIONS.has(".jpeg")).toBe(true);
  expect(NATIVE_EXTENSIONS.has(".png")).toBe(true);
  expect(NATIVE_EXTENSIONS.has(".webp")).toBe(true);
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

describe.skipIf(!JXL_TOOLS)("decodeJxlToRaw", () => {
  it("returns a raw RGB buffer sized width*height*channels", async () => {
    const src = path.join(dir, "raw-src.png");
    const jxl = path.join(dir, "raw.jxl");
    await makeJxl(src, jxl, 40, 24);

    const raw = await decodeJxlToRaw(jxl);
    expect(raw.width).toBe(40);
    expect(raw.height).toBe(24);
    expect(raw.channels).toBe(3);
    expect(raw.buffer.length).toBe(40 * 24 * 3);

    // The raw buffer is sharp-readable and re-encodes to the expected size.
    const meta = await sharp(raw.buffer, { raw: { width: 40, height: 24, channels: 3 } })
      .webp()
      .toBuffer()
      .then((b) => sharp(b).metadata());
    expect(meta.width).toBe(40);
    expect(meta.height).toBe(24);
  });

  it("rejects when djxl cannot decode the input", async () => {
    const bad = path.join(dir, "bad.jxl");
    await sharp({ create: { width: 4, height: 4, channels: 3, background: "#000" } })
      .png()
      .toFile(bad); // a PNG with a .jxl name — djxl should fail
    await expect(decodeJxlToRaw(bad)).rejects.toThrow();
  });
});
