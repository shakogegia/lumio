import { describe, expect, it } from "vitest";
import { FieldKind, FieldType } from "./enums.js";
import { BUILTIN_PRESETS, getPreset } from "./metadata-presets.js";

describe("built-in presets", () => {
  it("exposes only nlp", () => {
    expect(BUILTIN_PRESETS.map((p) => p.id)).toEqual(["nlp"]);
  });

  it("NLP preset mirrors NLP's four sections with the right field count", () => {
    const nlp = getPreset("nlp")!;
    expect(nlp.groups.map((g) => g.label)).toEqual([
      "Equipment",
      "Shooting",
      "Digitization",
      "Development",
    ]);
    // 26 fields mirror NLP's documented sections 2–5, plus an intentional "Roll"
    // (film frames share a roll; matches filmexif:RollID seen in real scans).
    const total = nlp.groups.reduce((n, g) => n + g.fields.length, 0);
    expect(total).toBe(27);
    expect(nlp.groups[0]!.fields.some((f) => f.key === "roll")).toBe(true);
    // every NLP field is custom
    expect(nlp.groups.every((g) => g.fields.every((f) => f.kind === FieldKind.Custom))).toBe(true);
    // unique keys
    const keys = nlp.groups.flatMap((g) => g.fields.map((f) => f.key));
    expect(new Set(keys).size).toBe(keys.length);
    // a representative field
    expect(nlp.groups[0]!.fields.find((f) => f.key === "film-iso")).toMatchObject({
      label: "Film ISO",
      type: FieldType.Number,
    });
    // choice fields ship with seeded options
    const filmFormat = nlp.groups[0]!.fields.find((f) => f.key === "film-format");
    expect(filmFormat?.options?.length).toBeGreaterThan(0);
  });

  it("getPreset returns undefined for an unknown id", () => {
    expect(getPreset("nope")).toBeUndefined();
  });
});
