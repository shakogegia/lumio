import { describe, expect, it } from "vitest";
import { albumTargetIds, selectableIds, summarizeRows, type Row } from "./upload-rows";

function mkRow(p: Partial<Row> & Pick<Row, "status">): Row {
  return {
    id: p.id ?? 1,
    file: p.file ?? ({} as File),
    name: p.name ?? "x.jpg",
    status: p.status,
    message: p.message,
    photoId: p.photoId,
  };
}

describe("summarizeRows", () => {
  it("counts outcomes and treats queued/uploading as pending", () => {
    const rows = [
      mkRow({ id: 1, status: "added", photoId: "a" }),
      mkRow({ id: 2, status: "added", photoId: "b" }),
      mkRow({ id: 3, status: "duplicate", photoId: "c" }),
      mkRow({ id: 4, status: "error", message: "boom" }),
      mkRow({ id: 5, status: "uploading" }),
      mkRow({ id: 6, status: "queued" }),
    ];
    expect(summarizeRows(rows)).toEqual({
      total: 6, done: 4, uploading: 2, added: 2, duplicate: 1, error: 1,
    });
  });
  it("is all-zero for an empty list", () => {
    expect(summarizeRows([])).toEqual({
      total: 0, done: 0, uploading: 0, added: 0, duplicate: 0, error: 0,
    });
  });
});

describe("selectableIds", () => {
  it("returns photo ids only for rows that have one", () => {
    const rows = [
      mkRow({ id: 1, status: "added", photoId: "a" }),
      mkRow({ id: 2, status: "duplicate", photoId: "b" }),
      mkRow({ id: 3, status: "error" }),
      mkRow({ id: 4, status: "uploading" }),
    ];
    expect(selectableIds(rows)).toEqual(["a", "b"]);
  });
});

describe("albumTargetIds", () => {
  it("collects added and duplicate ids, skipping errors and missing ids", () => {
    expect(
      albumTargetIds([
        { status: "added", photoId: "a" },
        { status: "duplicate", photoId: "b" },
        { status: "error" },
        { status: "added" }, // resolved without an id — defensively skipped
      ]),
    ).toEqual(["a", "b"]);
  });

  it("is empty for an all-failed batch", () => {
    expect(albumTargetIds([{ status: "error" }, { status: "error" }])).toEqual([]);
  });

  it("is empty for an empty batch", () => {
    expect(albumTargetIds([])).toEqual([]);
  });
});
