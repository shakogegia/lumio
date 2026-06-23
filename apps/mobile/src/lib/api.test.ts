import { describe, it, expect } from "vitest";
import { normalizeServerUrl } from "./api";

describe("normalizeServerUrl", () => {
  it("strips a trailing slash", () => {
    expect(normalizeServerUrl("http://localhost:3000/")).toBe("http://localhost:3000");
  });
  it("passes through a clean URL", () => {
    expect(normalizeServerUrl("https://photos.example.com")).toBe("https://photos.example.com");
  });
  it("trims surrounding whitespace", () => {
    expect(normalizeServerUrl("  http://192.168.1.50:3000  ")).toBe("http://192.168.1.50:3000");
  });
  it("throws when empty", () => {
    expect(() => normalizeServerUrl("")).toThrow(/enter .*server/i);
  });
  it("throws when blank", () => {
    expect(() => normalizeServerUrl("   ")).toThrow(/enter .*server/i);
  });
  it("throws when not http(s)", () => {
    expect(() => normalizeServerUrl("ftp://nope")).toThrow(/http/i);
  });
});
