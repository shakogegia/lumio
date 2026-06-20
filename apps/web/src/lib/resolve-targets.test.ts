import { describe, expect, it } from "vitest";
import { resolveTargets } from "./resolve-targets";

describe("resolveTargets", () => {
  it("returns the whole selection when the photo is in it", () => {
    const selected = new Set(["a", "b", "c"]);
    expect(new Set(resolveTargets(selected, "b"))).toEqual(selected);
  });

  it("returns just the photo when it is not in the selection", () => {
    expect(resolveTargets(new Set(["a", "b"]), "z")).toEqual(["z"]);
  });

  it("returns just the photo when the selection is empty", () => {
    expect(resolveTargets(new Set(), "z")).toEqual(["z"]);
  });

  it("returns just the photo when the selection is undefined", () => {
    expect(resolveTargets(undefined, "z")).toEqual(["z"]);
  });
});
