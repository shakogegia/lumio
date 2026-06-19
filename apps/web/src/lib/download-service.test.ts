import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  attachmentDisposition,
  dedupeEntryName,
  sanitizeZipName,
  streamPhotosZip,
} from "./download-service.js";

describe("dedupeEntryName", () => {
  it("returns the basename unchanged the first time", () => {
    const used = new Set<string>();
    expect(dedupeEntryName("a.jpg", used)).toBe("a.jpg");
    expect(used.has("a.jpg")).toBe(true);
  });

  it("suffixes collisions before the extension", () => {
    const used = new Set<string>();
    expect(dedupeEntryName("a.jpg", used)).toBe("a.jpg");
    expect(dedupeEntryName("a.jpg", used)).toBe("a (2).jpg");
    expect(dedupeEntryName("a.jpg", used)).toBe("a (3).jpg");
  });

  it("handles names without an extension", () => {
    const used = new Set<string>();
    expect(dedupeEntryName("README", used)).toBe("README");
    expect(dedupeEntryName("README", used)).toBe("README (2)");
  });
});

describe("sanitizeZipName", () => {
  it("keeps a clean name", () => {
    expect(sanitizeZipName("My Album")).toBe("My Album");
  });

  it("replaces path separators with dashes", () => {
    expect(sanitizeZipName("a/b\\c")).toBe("a-b-c");
  });

  it("strips reserved characters", () => {
    expect(sanitizeZipName('bad:"<>|?*name')).toBe("badname");
  });

  it("falls back to 'album' when empty or blank", () => {
    expect(sanitizeZipName("   ")).toBe("album");
    expect(sanitizeZipName("")).toBe("album");
  });
});

describe("attachmentDisposition", () => {
  it("builds an ascii filename plus a UTF-8 filename* parameter", () => {
    expect(attachmentDisposition("a.jpg")).toBe(
      "attachment; filename=\"a.jpg\"; filename*=UTF-8''a.jpg",
    );
  });

  it("downgrades non-ascii in the fallback and percent-encodes filename*", () => {
    const value = attachmentDisposition("café.jpg");
    expect(value).toContain('filename="caf_.jpg"');
    expect(value).toContain("filename*=UTF-8''caf%C3%A9.jpg");
  });
});

describe("streamPhotosZip", () => {
  it("zips the originals that exist and skips missing ones", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "lumio-dl-"));
    await writeFile(path.join(dir, "a.jpg"), "AAAA");
    await writeFile(path.join(dir, "b.jpg"), "BBBB");

    const res = streamPhotosZip(
      [
        { id: "1", path: "a.jpg" },
        { id: "2", path: "b.jpg" },
        { id: "3", path: "missing.jpg" },
      ],
      "test.zip",
      (rel) => path.join(dir, rel),
    );

    expect(res.headers.get("Content-Type")).toBe("application/zip");
    expect(res.headers.get("Content-Disposition")).toContain("test.zip");

    const buf = Buffer.from(await res.arrayBuffer());
    // Valid zip local-file-header magic.
    expect(buf.subarray(0, 2).toString("latin1")).toBe("PK");
    // Entry names are stored as plaintext in the zip; present files appear,
    // the missing one does not.
    expect(buf.includes(Buffer.from("a.jpg"))).toBe(true);
    expect(buf.includes(Buffer.from("b.jpg"))).toBe(true);
    expect(buf.includes(Buffer.from("missing.jpg"))).toBe(false);
  });
});
