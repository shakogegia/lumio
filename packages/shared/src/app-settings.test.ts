import { describe, expect, it } from "vitest";
import { normalizeBaseUrl, updateGeneralSettingsSchema } from "./app-settings.js";

describe("normalizeBaseUrl", () => {
  it("keeps a valid https origin", () => {
    expect(normalizeBaseUrl("https://photos.example.com")).toBe("https://photos.example.com");
  });
  it("trims a trailing slash", () => {
    expect(normalizeBaseUrl("https://photos.example.com/")).toBe("https://photos.example.com");
  });
  it("preserves a sub-path without trailing slash", () => {
    expect(normalizeBaseUrl("https://example.com/lumio/")).toBe("https://example.com/lumio");
  });
  it("accepts http", () => {
    expect(normalizeBaseUrl("http://localhost:3000")).toBe("http://localhost:3000");
  });
  it("rejects non-http(s) protocols", () => {
    expect(normalizeBaseUrl("ftp://x.test")).toBeNull();
  });
  it("rejects garbage", () => {
    expect(normalizeBaseUrl("not a url")).toBeNull();
  });
  it("treats empty/whitespace as null", () => {
    expect(normalizeBaseUrl("   ")).toBeNull();
  });
});

describe("updateGeneralSettingsSchema", () => {
  it("accepts a string", () => {
    expect(updateGeneralSettingsSchema.parse({ publicBaseUrl: " https://x.test " })).toEqual({
      publicBaseUrl: "https://x.test",
    });
  });
  it("accepts an empty string (to clear)", () => {
    expect(updateGeneralSettingsSchema.parse({ publicBaseUrl: "" })).toEqual({ publicBaseUrl: "" });
  });
});
