import { describe, expect, it } from "vitest";
import { updateProfileSchema } from "./profile.js";

describe("updateProfileSchema", () => {
  it("accepts soundEffectsEnabled: true", () => {
    expect(updateProfileSchema.parse({ soundEffectsEnabled: true })).toEqual({ soundEffectsEnabled: true });
  });
  it("accepts empty object (all fields optional)", () => {
    expect(updateProfileSchema.parse({})).toEqual({});
  });
  it("rejects soundEffectsEnabled as a non-boolean", () => {
    expect(() => updateProfileSchema.parse({ soundEffectsEnabled: "yes" })).toThrow();
  });
});
