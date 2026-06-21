import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { placeUpload } from "./place-upload.js";

const photosDir = await mkdtemp(path.join(tmpdir(), "lumio-place-"));
afterAll(async () => rm(photosDir, { recursive: true, force: true }));

describe("placeUpload", () => {
  it("writes the bytes to the requested relative path", async () => {
    const rel = await placeUpload({
      bytes: Buffer.from("hello"),
      relPath: "2024/2024-03-14/a.jpg",
      photosDir,
    });
    expect(rel).toBe("2024/2024-03-14/a.jpg");
    expect(await readFile(path.join(photosDir, rel), "utf8")).toBe("hello");
  });

  it("suffixes the filename when the target already exists", async () => {
    await writeFile(path.join(photosDir, "dup.jpg"), "first");
    const rel = await placeUpload({ bytes: Buffer.from("second"), relPath: "dup.jpg", photosDir });
    expect(rel).toBe("dup-1.jpg");
    expect(await readFile(path.join(photosDir, "dup.jpg"), "utf8")).toBe("first");
    expect(await readFile(path.join(photosDir, "dup-1.jpg"), "utf8")).toBe("second");
  });

  it("stamps the file mtime when one is provided", async () => {
    const when = new Date("2020-05-15T10:00:00.000Z");
    const rel = await placeUpload({
      bytes: Buffer.from("dated"),
      relPath: "dated.jpg",
      photosDir,
      mtime: when,
    });
    const st = await stat(path.join(photosDir, rel));
    expect(Math.round(st.mtimeMs)).toBe(when.getTime());
  });

  it("rejects path traversal", async () => {
    await expect(
      placeUpload({ bytes: Buffer.from("x"), relPath: "../escape.jpg", photosDir }),
    ).rejects.toThrow("Path traversal blocked");
  });
});
