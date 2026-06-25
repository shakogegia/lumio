import { describe, expect, it } from "vitest";
import { isPublicPath } from "./auth-paths.js";

describe("isPublicPath", () => {
  it("treats the login and setup pages as public", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/setup")).toBe(true);
  });

  it("treats the two-factor challenge page as public", () => {
    // During a 2FA sign-in challenge there is no full session cookie yet, so
    // the proxy must let /two-factor through or the user can never verify.
    expect(isPublicPath("/two-factor")).toBe(true);
  });

  it("treats the Better Auth API as public", () => {
    expect(isPublicPath("/api/auth")).toBe(true);
    expect(isPublicPath("/api/auth/sign-in/email")).toBe(true);
    expect(isPublicPath("/api/auth/ok")).toBe(true);
  });

  it("treats public share links and their token-scoped API as public", () => {
    expect(isPublicPath("/share/AbC123")).toBe(true);
    expect(isPublicPath("/api/share/AbC123/photos")).toBe(true);
    expect(isPublicPath("/api/share/AbC123/photos/p1/thumbnail")).toBe(true);
    expect(isPublicPath("/api/share/AbC123/download-all")).toBe(true);
    expect(isPublicPath("/api/share")).toBe(true);
  });

  it("keeps the authed shared-links management page and lookalikes private", () => {
    expect(isPublicPath("/shared")).toBe(false);
    expect(isPublicPath("/c/fam/shared")).toBe(false);
    expect(isPublicPath("/sharesomething")).toBe(false);
    expect(isPublicPath("/api/sharelinks")).toBe(false);
  });

  it("treats app pages and data routes as private", () => {
    expect(isPublicPath("/")).toBe(false);
    expect(isPublicPath("/photos")).toBe(false);
    expect(isPublicPath("/api/photos")).toBe(false);
    expect(isPublicPath("/loginsomething")).toBe(false);
    expect(isPublicPath("/login/")).toBe(false);
    expect(isPublicPath("/setup/")).toBe(false);
    expect(isPublicPath("/two-factorsomething")).toBe(false);
    expect(isPublicPath("/two-factor/")).toBe(false);
  });
});
