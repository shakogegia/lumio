import { describe, expect, it } from "vitest";
import { JOB_TYPES, isJobType, jobTypeSchema } from "./jobs.js";

describe("jobTypeSchema", () => {
  it("accepts the known job types", () => {
    for (const t of JOB_TYPES) expect(jobTypeSchema.parse(t)).toBe(t);
  });

  it("rejects unknown types", () => {
    expect(jobTypeSchema.safeParse("nope").success).toBe(false);
  });
});

describe("isJobType", () => {
  it("is a type guard over the known literals", () => {
    expect(isJobType("rescan")).toBe(true);
    expect(isJobType("purge_all")).toBe(true);
    expect(isJobType("nope")).toBe(false);
  });
});
