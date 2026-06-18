import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { extractUploadDate } from "./upload-date.js";

async function jpegWithExif(): Promise<Buffer> {
  return sharp({ create: { width: 8, height: 8, channels: 3, background: "#222" } })
    .withExif({ IFD2: { DateTimeOriginal: "2024:03:14 09:26:53" } })
    .jpeg()
    .toBuffer();
}

async function jpegNoExif(): Promise<Buffer> {
  return sharp({ create: { width: 8, height: 8, channels: 3, background: "#222" } })
    .jpeg()
    .toBuffer();
}

describe("extractUploadDate", () => {
  it("uses EXIF DateTimeOriginal when present", async () => {
    const date = await extractUploadDate(await jpegWithExif(), undefined, new Date("2030-01-01T00:00:00Z"));
    expect(date.getUTCFullYear()).toBe(2024);
    expect(date.getUTCMonth() + 1).toBe(3);
    expect(date.getUTCDate()).toBe(14);
  });

  it("falls back to lastModified when EXIF has no date", async () => {
    const lastModified = Date.UTC(2023, 4, 20); // 2023-05-20
    const date = await extractUploadDate(await jpegNoExif(), lastModified, new Date("2030-01-01T00:00:00Z"));
    expect(date.getTime()).toBe(lastModified);
  });

  it("falls back to now when neither EXIF nor lastModified is available", async () => {
    const now = new Date("2030-01-01T00:00:00Z");
    const date = await extractUploadDate(await jpegNoExif(), undefined, now);
    expect(date.getTime()).toBe(now.getTime());
  });
});
