import { describe, expect, it } from "vitest";
import { DEFAULT_UPLOAD_TEMPLATE, renderTemplate, validateTemplate } from "./uploads.js";

const date = new Date("2024-03-14T09:26:53.000Z");
const now = new Date("2026-06-27T18:30:00.000Z");

describe("renderTemplate", () => {
  it("renders the default year/day/filename layout", () => {
    expect(renderTemplate(DEFAULT_UPLOAD_TEMPLATE, { date, now, originalFilename: "IMG_1234.JPG" }))
      .toBe("2024/2024-03-14/IMG_1234.JPG");
  });

  it("supports the {ext} token", () => {
    expect(renderTemplate("{YYYY}/{MM}/{DD}.{ext}", { date, now, originalFilename: "p.png" }))
      .toBe("2024/03/14.png");
  });

  it("renders the current date with {NOW_YYYY}/{NOW_MM}/{NOW_DD}, distinct from the capture date", () => {
    expect(
      renderTemplate("{NOW_YYYY}/{NOW_MM}-{NOW_DD}/{TAKEN_YYYY}-{TAKEN_MM}-{TAKEN_DD}/{filename}", {
        date,
        now,
        originalFilename: "IMG_1234.JPG",
      }),
    ).toBe("2026/06-27/2024-03-14/IMG_1234.JPG");
  });

  it("renders the taken-at date with the prefixed {TAKEN_YYYY}/{TAKEN_MM}/{TAKEN_DD}", () => {
    expect(
      renderTemplate("{TAKEN_YYYY}/{TAKEN_MM}/{TAKEN_DD}/{filename}", {
        date,
        now,
        originalFilename: "IMG_1234.JPG",
      }),
    ).toBe("2024/03/14/IMG_1234.JPG");
  });

  it("still renders the legacy unprefixed {YYYY}/{MM}/{DD} as the taken-at date", () => {
    expect(
      renderTemplate("{YYYY}/{MM}/{DD}/{filename}", { date, now, originalFilename: "IMG_1234.JPG" }),
    ).toBe("2024/03/14/IMG_1234.JPG");
  });

  it("sanitizes path separators and control chars out of the filename", () => {
    expect(renderTemplate("{filename}", { date, now, originalFilename: "a/b\\c .jpg" }))
      .toBe("a_b_c_.jpg");
  });
});

describe("validateTemplate", () => {
  it("accepts a template containing {filename}", () => {
    expect(validateTemplate(DEFAULT_UPLOAD_TEMPLATE)).toEqual({ ok: true });
  });

  it("accepts a template containing {ext}", () => {
    expect(validateTemplate("{YYYY}/{MM}/{DD}.{ext}")).toEqual({ ok: true });
  });

  it("rejects empty templates", () => {
    expect(validateTemplate("   ").ok).toBe(false);
  });

  it("rejects templates without {filename} or {ext}", () => {
    expect(validateTemplate("{YYYY}/{MM}/{DD}").ok).toBe(false);
  });

  it("rejects '..' segments", () => {
    expect(validateTemplate("../{filename}").ok).toBe(false);
  });

  it("rejects a leading slash", () => {
    expect(validateTemplate("/{filename}").ok).toBe(false);
  });
});
