import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { hashBuffer, hashFile } from "./hash.js";

const dir = await mkdtemp(path.join(tmpdir(), "lumio-hash-"));
afterAll(async () => rm(dir, { recursive: true, force: true }));

describe("hashBuffer", () => {
  it("is the sha256 hex of the bytes and is deterministic", () => {
    const a = hashBuffer(Buffer.from("hello"));
    expect(a).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
    expect(hashBuffer(Buffer.from("hello"))).toBe(a);
  });

  it("differs when the bytes differ", () => {
    expect(hashBuffer(Buffer.from("a"))).not.toBe(hashBuffer(Buffer.from("b")));
  });
});

describe("hashFile", () => {
  it("hashes the file's bytes (matches hashBuffer of the same content)", async () => {
    const p = path.join(dir, "f.bin");
    const bytes = Buffer.from("some-image-bytes");
    await writeFile(p, bytes);
    expect(await hashFile(p)).toBe(hashBuffer(bytes));
  });
});
