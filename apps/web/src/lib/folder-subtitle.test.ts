import { describe, expect, it } from "vitest";
import { folderSubtitle } from "./folder-subtitle.js";

describe("folderSubtitle", () => {
  it("always shows the subfolder count and adds photos when > 0", () => {
    expect(folderSubtitle(2, 5)).toBe("2 folders · 5 photos");
    expect(folderSubtitle(1, 1)).toBe("1 folder · 1 photo");
  });
  it("omits the photo segment when there are no photos", () => {
    expect(folderSubtitle(3, 0)).toBe("3 folders");
    expect(folderSubtitle(0, 0)).toBe("0 folders");
  });
});
