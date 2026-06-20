import { describe, expect, it } from "vitest";
import { jobCompleted } from "./use-async-job.js";

describe("jobCompleted", () => {
  it("completes when pending, no longer active, and was seen active", () => {
    expect(jobCompleted("pending", false, true)).toBe(true);
  });
  it("does not complete while still active", () => {
    expect(jobCompleted("pending", true, true)).toBe(false);
  });
  it("does not complete if the job was never observed active", () => {
    expect(jobCompleted("pending", false, false)).toBe(false);
  });
  it("does not complete when idle", () => {
    expect(jobCompleted("idle", false, true)).toBe(false);
  });
});
