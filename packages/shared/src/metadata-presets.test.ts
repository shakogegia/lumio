import { describe, expect, it } from "vitest";
import { FieldKind, FieldType } from "./enums.js";
import { StandardFieldKey } from "./metadata-standard.js";
import { BUILTIN_PRESETS, getPreset } from "./metadata-presets.js";

describe("built-in presets", () => {
  it("exposes Film and Digital", () => {
    expect(BUILTIN_PRESETS.map((p) => p.id).sort()).toEqual(["digital", "film"]);
  });

  it("Film mirrors NLP's four sections with the right field count", () => {
    const film = getPreset("film")!;
    expect(film.groups.map((g) => g.label)).toEqual([
      "Equipment",
      "Shooting",
      "Digitization",
      "Development",
    ]);
    // 26 fields mirror NLP's documented sections 2–5, plus an intentional "Roll"
    // (film frames share a roll; matches filmexif:RollID seen in real scans).
    const total = film.groups.reduce((n, g) => n + g.fields.length, 0);
    expect(total).toBe(27);
    expect(film.groups[0]!.fields.some((f) => f.key === "roll")).toBe(true);
    // every Film field is custom
    expect(film.groups.every((g) => g.fields.every((f) => f.kind === FieldKind.Custom))).toBe(true);
    // unique keys
    const keys = film.groups.flatMap((g) => g.fields.map((f) => f.key));
    expect(new Set(keys).size).toBe(keys.length);
    // a representative field
    expect(film.groups[0]!.fields.find((f) => f.key === "film-iso")).toMatchObject({
      label: "Film ISO",
      type: FieldType.Number,
    });
  });

  it("Digital is all standard fields wired to STANDARD_FIELDS", () => {
    const digital = getPreset("digital")!;
    const fields = digital.groups.flatMap((g) => g.fields);
    expect(fields.every((f) => f.kind === FieldKind.Standard)).toBe(true);
    expect(fields.map((f) => f.builtinKey)).toContain(StandardFieldKey.Aperture);
  });

  it("getPreset returns undefined for an unknown id", () => {
    expect(getPreset("nope")).toBeUndefined();
  });
});
