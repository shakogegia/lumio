import { describe, expect, it } from "vitest";
import { collectFromEntries, isSupported, partitionSupported, type FsEntry } from "./upload-collect";

function fileEntry(name: string): FsEntry {
  return { isFile: true, isDirectory: false, file: (cb) => cb(new File([name], name)) };
}
function dirEntry(children: FsEntry[]): FsEntry {
  let handed = false;
  return {
    isFile: false,
    isDirectory: true,
    createReader: () => ({
      readEntries: (cb) => {
        // First call returns the children, subsequent call signals "drained".
        if (handed) return cb([]);
        handed = true;
        cb(children);
      },
    }),
  };
}

describe("isSupported", () => {
  it("accepts known image extensions, rejects others", () => {
    expect(isSupported("IMG.JPG")).toBe(true);
    expect(isSupported("scan.heic")).toBe(true);
    expect(isSupported("IMG.jpg.xmp")).toBe(false);
    expect(isSupported("raw.dng")).toBe(false);
    expect(isSupported("noext")).toBe(false);
  });
});

describe("partitionSupported", () => {
  it("splits supported files from skipped count", () => {
    const files = [new File(["a"], "a.jpg"), new File(["b"], "b.xmp"), new File(["c"], "c.dng")];
    const { supported, skipped } = partitionSupported(files);
    expect(supported.map((f) => f.name)).toEqual(["a.jpg"]);
    expect(skipped).toBe(2);
  });
});

describe("collectFromEntries", () => {
  it("recursively flattens files from nested directories", async () => {
    const tree: FsEntry[] = [
      fileEntry("top.jpg"),
      dirEntry([fileEntry("a.jpg"), dirEntry([fileEntry("deep.png")])]),
    ];
    const files = await collectFromEntries(tree);
    expect(files.map((f) => f.name).sort()).toEqual(["a.jpg", "deep.png", "top.jpg"]);
  });
});
