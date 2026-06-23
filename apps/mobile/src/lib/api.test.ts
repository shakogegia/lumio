import { describe, it, expect } from "vitest";
import { resolveApiBaseUrl } from "./api";

describe("resolveApiBaseUrl", () => {
  it("returns the configured URL without a trailing slash", () => {
    expect(resolveApiBaseUrl("http://localhost:3000/")).toBe(
      "http://localhost:3000",
    );
  });

  it("passes through a URL that has no trailing slash", () => {
    expect(resolveApiBaseUrl("http://192.168.1.50:3000")).toBe(
      "http://192.168.1.50:3000",
    );
  });

  it("throws a clear error when the URL is missing", () => {
    expect(() => resolveApiBaseUrl(undefined)).toThrow(/EXPO_PUBLIC_API_URL/);
  });

  it("throws when the URL is blank", () => {
    expect(() => resolveApiBaseUrl("   ")).toThrow(/EXPO_PUBLIC_API_URL/);
  });

  it("throws when the URL is not http(s)", () => {
    expect(() => resolveApiBaseUrl("ftp://nope")).toThrow(/http/);
  });
});
