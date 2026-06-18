import { describe, expect, it } from "vitest";
import { DEFAULT_UPLOAD_TEMPLATE, renderTemplate, validateTemplate } from "./uploads.js";

const date = new Date("2024-03-14T09:26:53.000Z");

describe("renderTemplate", () => {
  it("renders the default year/day/filename layout", () => {
    expect(renderTemplate(DEFAULT_UPLOAD_TEMPLATE, { date, originalFilename: "IMG_1234.JPG" }))
      .toBe("2024/2024-03-14/IMG_1234.JPG");
  });

  it("supports the {ext} token", () => {
    expect(renderTemplate("{YYYY}/{MM}/{DD}.{ext}", { date, originalFilename: "p.png" }))
      .toBe("2024/03/14.png");
  });

  it("sanitizes path separators and control chars out of the filename", () => {
    expect(renderTemplate("{filename}", { date, originalFilename: "a/b\\c .jpg" }))
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
