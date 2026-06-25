import { describe, expect, it } from "vitest";
import { evaluateShareAccess } from "./share-access.js";

const link = (over: Partial<{ passwordHash: string | null; expiresAt: Date | null }> = {}) => ({
  passwordHash: null as string | null,
  expiresAt: null as Date | null,
  ...over,
});
const NOW = new Date("2026-06-25T00:00:00Z");

describe("evaluateShareAccess", () => {
  it("denies when the feature is disabled", () => {
    expect(evaluateShareAccess({ link: link(), featureEnabled: false, unlocked: false, now: NOW }))
      .toEqual({ ok: false, reason: "unavailable" });
  });
  it("denies when expired", () => {
    const r = evaluateShareAccess({ link: link({ expiresAt: new Date("2026-06-24T00:00:00Z") }), featureEnabled: true, unlocked: false, now: NOW });
    expect(r).toEqual({ ok: false, reason: "unavailable" });
  });
  it("requires a password when one is set and not unlocked", () => {
    const r = evaluateShareAccess({ link: link({ passwordHash: "h" }), featureEnabled: true, unlocked: false, now: NOW });
    expect(r).toEqual({ ok: false, reason: "password" });
  });
  it("allows when unlocked", () => {
    const r = evaluateShareAccess({ link: link({ passwordHash: "h" }), featureEnabled: true, unlocked: true, now: NOW });
    expect(r).toEqual({ ok: true });
  });
  it("allows a public (no-password, unexpired, enabled) link", () => {
    expect(evaluateShareAccess({ link: link(), featureEnabled: true, unlocked: false, now: NOW })).toEqual({ ok: true });
  });
});
