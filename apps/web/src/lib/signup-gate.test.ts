import { APIError } from "better-auth/api";
import { describe, expect, it } from "vitest";
import { assertSignupAllowed } from "./signup-gate.js";

describe("assertSignupAllowed", () => {
  it("allows the first signup when no user exists", () => {
    expect(() => assertSignupAllowed("/sign-up/email", false)).not.toThrow();
  });

  it("blocks signup once a user exists", () => {
    expect(() => assertSignupAllowed("/sign-up/email", true)).toThrow(APIError);
  });

  it("ignores non-signup paths even when no user exists", () => {
    expect(() => assertSignupAllowed("/sign-in/email", false)).not.toThrow();
    expect(() => assertSignupAllowed("/sign-in/email", true)).not.toThrow();
  });
});
