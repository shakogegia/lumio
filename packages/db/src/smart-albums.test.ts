import { describe, expect, it } from "vitest";
import { MatchType, RuleOp } from "@lumio/shared";
import { smartAlbumWhere } from "./smart-albums.js";

const now = new Date("2026-06-17T00:00:00.000Z");

describe("smartAlbumWhere", () => {
  it("last_30_days → AND clause with takenAt gte cutoff", () => {
    const result = smartAlbumWhere(
      { match: MatchType.all, rules: [{ field: "takenAt", op: RuleOp.last_30_days }] },
      now,
    );
    const expected = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    expect(result).toEqual({ AND: [{ takenAt: { gte: expected } }] });
  });

  it("cameraModel eq → AND clause with exif JSON path", () => {
    const result = smartAlbumWhere(
      {
        match: MatchType.all,
        rules: [{ field: "exif.cameraModel", op: RuleOp.eq, value: "iPhone" }],
      },
      now,
    );
    expect(result).toEqual({
      AND: [{ exif: { path: ["cameraModel"], equals: "iPhone" } }],
    });
  });

  it("match any with two rules → OR with 2 clauses", () => {
    const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const result = smartAlbumWhere(
      {
        match: MatchType.any,
        rules: [
          { field: "takenAt", op: RuleOp.last_30_days },
          { field: "exif.cameraModel", op: RuleOp.eq, value: "iPhone" },
        ],
      },
      now,
    );
    expect(result).toEqual({
      OR: [
        { takenAt: { gte: cutoff } },
        { exif: { path: ["cameraModel"], equals: "iPhone" } },
      ],
    });
  });

  it("empty rules → { id: { in: [] } }", () => {
    const result = smartAlbumWhere({ match: MatchType.all, rules: [] }, now);
    expect(result).toEqual({ id: { in: [] } });
  });

  it("unknown field/op combination → throws unsupported rule", () => {
    expect(() =>
      smartAlbumWhere(
        { match: MatchType.all, rules: [{ field: "x", op: "y" } as never] },
        now,
      ),
    ).toThrow("unsupported rule");
  });
});
