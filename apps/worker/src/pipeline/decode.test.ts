import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { decodeToReadable, CONVERTERS, NATIVE_EXTENSIONS } from "./decode.js";

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
