import { describe, expect, it } from "vitest";
import { createShareLinkSchema, shareUnlockSchema } from "./share-links.js";

describe("createShareLinkSchema", () => {
  it("accepts a minimal body (just photoIds)", () => {
    const v = createShareLinkSchema.parse({ photoIds: ["p1", "p2"] });
    expect(v.photoIds).toEqual(["p1", "p2"]);
    expect(v.title).toBeUndefined();
    expect(v.password).toBeUndefined();
    expect(v.expiresAt).toBeUndefined();
  });
  it("accepts title, password and an ISO expiry", () => {
    const v = createShareLinkSchema.parse({
      photoIds: ["p1"],
      title: "Wedding",
      password: "hunter2",
      expiresAt: "2026-12-31T00:00:00.000Z",
    });
    expect(v.title).toBe("Wedding");
    expect(v.password).toBe("hunter2");
    expect(v.expiresAt).toBe("2026-12-31T00:00:00.000Z");
  });
  it("rejects an empty photoIds array", () => {
    expect(() => createShareLinkSchema.parse({ photoIds: [] })).toThrow();
  });
  it("rejects a non-ISO expiry", () => {
    expect(() => createShareLinkSchema.parse({ photoIds: ["p1"], expiresAt: "soon" })).toThrow();
  });
  it("treats empty title/password as omitted", () => {
    const v = createShareLinkSchema.parse({ photoIds: ["p1"], title: "  ", password: "" });
    expect(v.title).toBeUndefined();
    expect(v.password).toBeUndefined();
  });
});

describe("shareUnlockSchema", () => {
  it("accepts a non-empty password", () => {
    expect(shareUnlockSchema.parse({ password: "pw" })).toEqual({ password: "pw" });
  });
  it("rejects an empty password", () => {
    expect(() => shareUnlockSchema.parse({ password: "" })).toThrow();
  });
});
