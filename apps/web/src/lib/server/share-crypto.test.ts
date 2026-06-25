import { describe, expect, it, beforeAll } from "vitest";
import {
  generateShareToken,
  hashPassword,
  verifyPassword,
  signUnlock,
  verifyUnlock,
} from "./share-crypto.js";

beforeAll(() => {
  process.env.BETTER_AUTH_SECRET ??= "test-secret-for-share-crypto";
});

describe("generateShareToken", () => {
  it("produces a URL-safe token of usable length, unique per call", () => {
    const a = generateShareToken();
    const b = generateShareToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeGreaterThanOrEqual(24);
    expect(a).not.toBe(b);
  });
});

describe("password hash/verify", () => {
  it("verifies the correct password and rejects a wrong one", async () => {
    const stored = await hashPassword("hunter2");
    expect(stored).toContain(":");
    expect(await verifyPassword("hunter2", stored)).toBe(true);
    expect(await verifyPassword("nope", stored)).toBe(false);
  });
  it("rejects a malformed stored value", async () => {
    expect(await verifyPassword("x", "garbage")).toBe(false);
  });
});

describe("unlock signature", () => {
  it("round-trips for the same token and rejects a different token or bad sig", () => {
    const sig = signUnlock("tok-1");
    expect(verifyUnlock("tok-1", sig)).toBe(true);
    expect(verifyUnlock("tok-2", sig)).toBe(false);
    expect(verifyUnlock("tok-1", "deadbeef")).toBe(false);
    expect(verifyUnlock("tok-1", "")).toBe(false);
  });
});
