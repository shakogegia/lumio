import { describe, expect, it } from "vitest";
import { pollInterval } from "./poll-interval.js";

describe("pollInterval", () => {
  it("pauses on a hidden tab", () => {
    expect(pollInterval(true, true)).toBeNull();
  });
  it("polls fast when a job is active", () => {
    expect(pollInterval(true, false)).toBe(1500);
  });
  it("polls slow when idle", () => {
    expect(pollInterval(false, false)).toBe(5000);
  });
});
