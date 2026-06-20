import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { countImageFiles, dirSize } from "./status-service.js";

const base = await mkdtemp(path.join(tmpdir(), "lumio-dirsize-"));
afterAll(async () => rm(base, { recursive: true, force: true }));

describe("dirSize", () => {
  it("returns 0 for a missing directory", async () => {
    expect(await dirSize(path.join(base, "nope"))).toBe(0);
  });

  it("sums file sizes recursively across subdirectories", async () => {
    const dir = path.join(base, "tree");
    const sub = path.join(dir, "nested");
    await mkdir(sub, { recursive: true });
    await writeFile(path.join(dir, "a.bin"), Buffer.alloc(100));
    await writeFile(path.join(dir, "b.bin"), Buffer.alloc(250));
    await writeFile(path.join(sub, "c.bin"), Buffer.alloc(650));
    expect(await dirSize(dir)).toBe(1000);
  });

  it("sums correctly across more files than one batch (bounded concurrency)", async () => {
    const dir = path.join(base, "many");
    await mkdir(dir, { recursive: true });
    // 200 files (> the internal batch size) of 10 bytes each = 2000 bytes
    await Promise.all(
      Array.from({ length: 200 }, (_, i) =>
        writeFile(path.join(dir, `f${i}.bin`), Buffer.alloc(10)),
      ),
    );
    expect(await dirSize(dir)).toBe(2000);
  });
});

describe("countImageFiles", () => {
  it("returns 0 for a missing directory", async () => {
    expect(await countImageFiles(path.join(base, "absent"))).toBe(0);
  });

  it("counts only supported image files, recursively, case-insensitively", async () => {
    const dir = path.join(base, "lib");
    const sub = path.join(dir, "2024");
    await mkdir(sub, { recursive: true });
    await writeFile(path.join(dir, "a.jpg"), "");
    await writeFile(path.join(dir, "b.JPEG"), ""); // uppercase ext counts
    await writeFile(path.join(dir, "c.png"), "");
    await writeFile(path.join(dir, "notes.txt"), ""); // unsupported
    await writeFile(path.join(dir, ".DS_Store"), ""); // unsupported
    await writeFile(path.join(sub, "d.heic"), ""); // nested, supported
    expect(await countImageFiles(dir)).toBe(4);
  });
});
