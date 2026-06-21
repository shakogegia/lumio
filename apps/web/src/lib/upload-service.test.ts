import { access, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { DEFAULT_UPLOAD_TEMPLATE } from "@lumio/shared";
import { handleUpload } from "./upload-service.js";

const base = await mkdtemp(path.join(tmpdir(), "lumio-upload-"));
const photosDir = path.join(base, "photos");
const thumbnailsDir = path.join(base, "thumbs");
const displaysDir = path.join(base, "displays");
afterAll(async () => rm(base, { recursive: true, force: true }));

async function jpeg(): Promise<Buffer> {
  return sharp({ create: { width: 16, height: 16, channels: 3, background: "#3366aa" } })
    .jpeg()
    .toBuffer();
}

function fakeDb(existing: { id: string } | null) {
  return {
    photo: {
      findFirst: async () => existing,
      upsert: async () => ({ id: "newid" }),
    },
  };
}

const deps = (existing: { id: string } | null) => ({
  db: fakeDb(existing) as never,
  photosDir,
  thumbnailsDir,
  displaysDir,
  template: DEFAULT_UPLOAD_TEMPLATE,
});

describe("handleUpload", () => {
  it("rejects unsupported extensions", async () => {
    const result = await handleUpload(
      { bytes: Buffer.from("x"), originalFilename: "notes.txt" },
      deps(null),
    );
    expect(result).toEqual({ status: "unsupported" });
  });

  it("reports duplicates without writing", async () => {
    const result = await handleUpload(
      { bytes: await jpeg(), originalFilename: "dup.jpg" },
      deps({ id: "existing" }),
    );
    expect(result).toEqual({ status: "duplicate", id: "existing" });
  });

  it("rejects an invalid template defensively", async () => {
    const result = await handleUpload(
      { bytes: await jpeg(), originalFilename: "IMG_2.jpg" },
      { ...deps(null), template: "{YYYY}" }, // no {filename}/{ext}
    );
    expect(result.status).toBe("error");
  });

  it("files a new photo using the template (lastModified date) and writes renditions", async () => {
    const lastModified = Date.UTC(2023, 4, 20); // 2023-05-20
    const result = await handleUpload(
      { bytes: await jpeg(), originalFilename: "IMG_1.jpg", lastModified },
      deps(null),
    );
    expect(result.status).toBe("added");
    if (result.status !== "added") throw new Error("expected added");
    expect(result.path).toBe("2023/2023-05-20/IMG_1.jpg");
    expect(result.id).toBe("newid");
    await expect(access(path.join(photosDir, "2023/2023-05-20/IMG_1.jpg"))).resolves.toBeUndefined();
    await expect(access(path.join(thumbnailsDir, "newid.webp"))).resolves.toBeUndefined();
    await expect(access(path.join(displaysDir, "newid.webp"))).resolves.toBeUndefined();
    const st = await stat(path.join(photosDir, "2023/2023-05-20/IMG_1.jpg"));
    expect(Math.round(st.mtimeMs)).toBe(lastModified);
  });
});
