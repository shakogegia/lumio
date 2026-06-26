import { describe, expect, it } from "vitest";
import { RuleOp } from "@lumio/shared";
import { mergeEditorRules } from "./editor-rules";

describe("mergeEditorRules", () => {
  it("combines chip rules with rules parsed from free text; q is the leftover", () => {
    const out = mergeEditorRules(
      [{ field: "cameraModel", op: RuleOp.in_list, value: ["Sony"] }],
      "iso:>800 beach",
    );
    expect(out.rules).toEqual([
      { field: "cameraModel", op: RuleOp.in_list, value: ["Sony"] },
      { field: "iso", op: RuleOp.gt, value: 800 },
    ]);
    expect(out.q).toBe("beach");
  });
  it("no chips, no tokens → empty rules, q is the text", () => {
    expect(mergeEditorRules([], "sunset")).toEqual({ rules: [], q: "sunset" });
  });
});
