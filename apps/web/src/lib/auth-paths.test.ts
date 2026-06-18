import { describe, expect, it } from "vitest";
import { isPublicPath } from "./auth-paths.js";

describe("isPublicPath", () => {
  it("treats the login and setup pages as public", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/setup")).toBe(true);
  });

  it("treats the Better Auth API as public", () => {
    expect(isPublicPath("/api/auth/sign-in/email")).toBe(true);
    expect(isPublicPath("/api/auth/ok")).toBe(true);
  });

  it("treats app pages and data routes as private", () => {
    expect(isPublicPath("/")).toBe(false);
    expect(isPublicPath("/photos")).toBe(false);
    expect(isPublicPath("/api/photos")).toBe(false);
    expect(isPublicPath("/loginsomething")).toBe(false);
  });
});
