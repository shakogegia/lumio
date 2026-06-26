import { describe, expect, it } from "vitest";
import { RuleOp } from "@lumio/shared";
import { readMultiselect, applyMultiselect, readRange, applyRange, readToggle, applyToggle, readDateRange, applyDateRange, readOrientation, applyOrientation } from "./panel-rules";

describe("multiselect mapping", () => {
  it("reads the selected values from an in_list rule", () => {
    expect(readMultiselect([{ field: "cameraModel", op: RuleOp.in_list, value: ["Sony", "Nikon"] }], "cameraModel")).toEqual(["Sony", "Nikon"]);
    expect(readMultiselect([], "cameraModel")).toEqual([]);
  });
  it("apply replaces that field's rule with an in_list; empty selection drops it", () => {
    const r1 = applyMultiselect([], "cameraModel", ["Sony"]);
    expect(r1).toEqual([{ field: "cameraModel", op: RuleOp.in_list, value: ["Sony"] }]);
    const r2 = applyMultiselect(r1, "cameraModel", ["Sony", "Nikon"]);
    expect(r2).toEqual([{ field: "cameraModel", op: RuleOp.in_list, value: ["Sony", "Nikon"] }]);
    expect(applyMultiselect(r2, "cameraModel", [])).toEqual([]);
  });
  it("apply leaves other fields untouched", () => {
    const start = [{ field: "iso", op: RuleOp.gt, value: 800 }];
    expect(applyMultiselect(start, "cameraModel", ["Sony"])).toEqual([
      { field: "iso", op: RuleOp.gt, value: 800 },
      { field: "cameraModel", op: RuleOp.in_list, value: ["Sony"] },
    ]);
  });
});

describe("range mapping", () => {
  it("reads {min,max} from gte/lte/between rules", () => {
    expect(readRange([{ field: "iso", op: RuleOp.between, value: [200, 1600] }], "iso")).toEqual({ min: 200, max: 1600 });
    expect(readRange([{ field: "iso", op: RuleOp.gte, value: 800 }], "iso")).toEqual({ min: 800, max: null });
    expect(readRange([], "iso")).toEqual({ min: null, max: null });
  });
  it("apply emits between/gte/lte and drops when both empty", () => {
    expect(applyRange([], "iso", { min: 200, max: 1600 })).toEqual([{ field: "iso", op: RuleOp.between, value: [200, 1600] }]);
    expect(applyRange([], "iso", { min: 800, max: null })).toEqual([{ field: "iso", op: RuleOp.gte, value: 800 }]);
    expect(applyRange([], "iso", { min: null, max: 100 })).toEqual([{ field: "iso", op: RuleOp.lte, value: 100 }]);
    expect(applyRange([{ field: "iso", op: RuleOp.gte, value: 1 }], "iso", { min: null, max: null })).toEqual([]);
  });
});

describe("toggle mapping", () => {
  it("reads + applies a boolean eq rule (hasGps)", () => {
    expect(readToggle([{ field: "hasGps", op: RuleOp.eq, value: true }], "hasGps")).toBe(true);
    expect(readToggle([], "hasGps")).toBe(false);
    expect(applyToggle([], "hasGps", true)).toEqual([{ field: "hasGps", op: RuleOp.eq, value: true }]);
    expect(applyToggle([{ field: "hasGps", op: RuleOp.eq, value: true }], "hasGps", false)).toEqual([]);
  });
});

describe("date range mapping", () => {
  it("reads ISO back to YYYY-MM-DD and applies between/gte/lte with full ISO", () => {
    expect(readDateRange([{ field: "takenAt", op: RuleOp.between, value: ["2024-01-01T00:00:00.000Z", "2024-12-31T23:59:59.999Z"] }], "takenAt")).toEqual({ from: "2024-01-01", to: "2024-12-31" });
    expect(applyDateRange([], "takenAt", { from: "2024-01-01", to: "" })).toEqual([{ field: "takenAt", op: RuleOp.gte, value: "2024-01-01T00:00:00.000Z" }]);
    expect(applyDateRange([], "takenAt", { from: "", to: "2024-12-31" })).toEqual([{ field: "takenAt", op: RuleOp.lte, value: "2024-12-31T23:59:59.999Z" }]);
    expect(applyDateRange([], "takenAt", { from: "2024-01-01", to: "2024-12-31" })).toEqual([{ field: "takenAt", op: RuleOp.between, value: ["2024-01-01T00:00:00.000Z", "2024-12-31T23:59:59.999Z"] }]);
    expect(applyDateRange([{ field: "takenAt", op: RuleOp.gte, value: "x" }], "takenAt", { from: "", to: "" })).toEqual([]);
  });
  it("leaves other fields untouched", () => {
    expect(applyDateRange([{ field: "iso", op: RuleOp.gt, value: 800 }], "takenAt", { from: "2024-01-01", to: "" })).toEqual([
      { field: "iso", op: RuleOp.gt, value: 800 },
      { field: "takenAt", op: RuleOp.gte, value: "2024-01-01T00:00:00.000Z" },
    ]);
  });
});

describe("orientation mapping", () => {
  it("maps portrait/landscape/any to orientation rules (EXIF enum: 5-8 = rotated)", () => {
    expect(applyOrientation([], "portrait")).toEqual([{ field: "orientation", op: RuleOp.gte, value: 5 }]);
    expect(applyOrientation([], "landscape")).toEqual([{ field: "orientation", op: RuleOp.lt, value: 5 }]);
    expect(applyOrientation([{ field: "orientation", op: RuleOp.gte, value: 5 }], "any")).toEqual([]);
    expect(readOrientation([{ field: "orientation", op: RuleOp.lt, value: 5 }])).toBe("landscape");
    expect(readOrientation([{ field: "orientation", op: RuleOp.gte, value: 5 }])).toBe("portrait");
    expect(readOrientation([])).toBe("any");
  });
  it("orientation leaves other fields untouched", () => {
    expect(applyOrientation([{ field: "iso", op: RuleOp.gt, value: 800 }], "portrait")).toEqual([
      { field: "iso", op: RuleOp.gt, value: 800 },
      { field: "orientation", op: RuleOp.gte, value: 5 },
    ]);
  });
});
