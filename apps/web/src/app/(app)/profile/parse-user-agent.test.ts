import { describe, expect, it } from "vitest";
import { parseUserAgent } from "./parse-user-agent.js";

describe("parseUserAgent", () => {
  it("detects Chrome on macOS", () => {
    const ua =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    expect(parseUserAgent(ua)).toEqual({ browser: "Chrome", os: "macOS" });
  });

  it("detects Safari on iOS", () => {
    const ua =
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
    expect(parseUserAgent(ua)).toEqual({ browser: "Safari", os: "iOS" });
  });

  it("detects Firefox on Windows", () => {
    const ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0";
    expect(parseUserAgent(ua)).toEqual({ browser: "Firefox", os: "Windows" });
  });

  it("detects Edge on Windows (not Chrome)", () => {
    const ua =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0";
    expect(parseUserAgent(ua)).toEqual({ browser: "Edge", os: "Windows" });
  });

  it("detects Chrome on Android (not Linux)", () => {
    const ua =
      "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
    expect(parseUserAgent(ua)).toEqual({ browser: "Chrome", os: "Android" });
  });

  it("falls back to Unknown for null/empty input", () => {
    expect(parseUserAgent(null)).toEqual({
      browser: "Unknown browser",
      os: "Unknown OS",
    });
    expect(parseUserAgent("")).toEqual({
      browser: "Unknown browser",
      os: "Unknown OS",
    });
  });
});
