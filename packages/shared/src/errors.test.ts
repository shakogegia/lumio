import { describe, expect, it } from "vitest";
import { errorMessage } from "./errors.js";

describe("errorMessage", () => {
  it("returns the message of an Error", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });

  it("returns a string as-is", () => {
    expect(errorMessage("oops")).toBe("oops");
  });

  it("converts a plain object via String()", () => {
    expect(errorMessage({ code: 42 })).toBe("[object Object]");
  });

  it("converts null via String()", () => {
    expect(errorMessage(null)).toBe("null");
  });

  it("converts a number via String()", () => {
    expect(errorMessage(500)).toBe("500");
  });
});
