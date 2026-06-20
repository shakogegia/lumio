import { describe, expect, it } from "vitest";
import { timedLine } from "./format.js";

describe("timedLine", () => {
  it("appends the lowercased extension and rounded milliseconds", () => {
    expect(timedLine("2024/DCM_5868.NEF.jxl", 417.6)).toBe("2024/DCM_5868.NEF.jxl (.jxl) 418ms");
  });

  it("lowercases the extension and rounds down sub-half ms", () => {
    expect(timedLine("a/b.JPG", 12.2)).toBe("a/b.JPG (.jpg) 12ms");
  });
});
