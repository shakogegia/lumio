import { describe, expect, it } from "vitest";
import { validatePasswordChange } from "./validate-password-change.js";

describe("validatePasswordChange", () => {
  it("rejects a new password shorter than 8 characters", () => {
    expect(validatePasswordChange("short", "short")).toBe(
      "New password must be at least 8 characters.",
    );
  });

  it("rejects when the confirmation does not match", () => {
    expect(validatePasswordChange("longenough1", "different1")).toBe(
      "Passwords do not match.",
    );
  });

  it("returns null when the password is long enough and matches", () => {
    expect(validatePasswordChange("longenough1", "longenough1")).toBeNull();
  });
});
